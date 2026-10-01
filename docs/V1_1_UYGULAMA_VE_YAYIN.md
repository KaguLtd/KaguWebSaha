# V1.1 uygulama ve yayın notları

Dal: `codex/v1-1`. Başlangıç: `7c7d2ffcd1be2838a0452a18dc416d995e1199c9`.
Geliştirme mevcut Next.js/PostgreSQL yapısı içinde yapılmıştır. Canlı migration, veri reset/seed, bootstrap veya sunucu yayını yapılmamıştır.

## Tamamlanan çekirdek

| Alan | Yeni davranış |
| --- | --- |
| Personel | Not/olay ve seçilen dosyalar, başarı mesajından önce kullanıcıya bağlı IndexedDB transaction'ında saklanır. Kamera, galeri, önizleme ve dosya kaldırma ayrı kontrollerdir. Not ve varış/ayrılış büyük videoyu beklemez. |
| Bekleyenler | Personel Ayarlar ve admin/observer Ziyaret sayfasında durum/hata, tekrar dene, yeniden seç, cihaza kaydet ve onayla sil. Başarısız dosya kendiliğinden silinmez. |
| Devam edebilir yükleme | Oturum, 128 KiB istemci parçaları, sunucuda en fazla 2 MiB parça, doğrulanmış bayt konumu, tekrar parça kontrolü ve tek finalize. Kesintide onaylanan konumdan devam. |
| Tekilleştirme | Not/olay/ziyaret işlemlerinin makbuzu iş kayıtlarıyla birlikte commit olur. Kayıp HTTP yanıtında aynı client ID tekrar gönderilebilir. Dosyada aynı oturum tek ProjectFile/timeline üretir. |
| Saha olayları | Kalıcı sıra ve sekmeler arasında gönderim sahipliği. Ortak görev durum geçişlerinde sunucu kilidi. En fazla 7 günlük gecikmiş olay özgün görev gününe uygulanır; geçmiş görev yeniden ON_SITE yapılmaz. Daha eski olay cihazda yönetici incelemesine bırakılır. |
| Medya işleri | HEIC ve önizleme bağımsız derlenmiş worker'da çalışabilir. Kilit/heartbeat, 5 deneme, artan bekleme, yönetici tekrar denemesi. Commit sonrasındaki temizlik/yenileme hatası başarılı kaydı bozmaz. |
| Temizlik | Yalnız süresi dolan/iptal edilen kısmi aktarım veya DB ve disk üzerinde doğrulanmış tamamlanmış geçici kaynak temizlenir. Başarısız HEIC kaynağı korunur. |
| Video okuma | Streaming, Range/206/416, HEAD ve If-Range. Mevcut rol erişimi korunur; aktif içerik türleri indirme olarak servis edilir. |
| Ziyaret | 0–15 gün normal, 16–30 turuncu, 31+ kırmızı, hiç ziyaret yok gri. Filtre/sıralama ve dashboard'da Dün Yapılanlar altında Bugün Ziyaret Edilenler. Şantiye/ziyaret sayıları ayrı. |
| Ziyaret doğruluğu | Yeni ziyaret ve tarihsel SITE_VISITED birlikte okunur; timeline karşılığı iki kez sayılmaz. Observer sahipliği, arşiv kontrolü, gece yarısı ve hata halinde notun korunması. |
| Takvim | Masaüstü hücresi 192 px, görev alanı 144 px, iki satır proje adı ve tam ad tooltip. Mevcut aylık/mobil yapı ve drawer korunur. |
| Taşeron ekip | Kullanıcılar altında temsilci, hesabı olmayan kişi sayısı, temsilciyi dahil etme, başlangıç tarihi. Bir temsilcinin bir aktif ekibi olabilir. Görevde tarihsel ad/sayı/işgücü sınıfı snapshot'ı tutulur. |
| Fiili mevcud | Taşeron varışında 0–500 kişi beyanı. Yönetici açıklamayla düzeltebilir; eski/yeni değer timeline'a eklenir. Plan sayısı ve eski rapor korunur. |
| Raporlar | Proje, personel/ekip, cari ve ziyaret; önizleme/kaydetme, tarih/proje/cari/personel/ekip/durum/aktif-arşiv filtreleri, arama ve 25'li sayfalama. Excel uyumlu CSV ve yazdır/PDF. Eski SavedReport JSON'u yeniden hesaplanmaz. |

Raporlarda plan katılımı, varış, fiili ekip beyanı, tekilleştirilmiş hesap/ekip günü ve ortak görev süresi ayrı metriklerdir. Observer işgücüne eklenmez. Eksik tarihsel sayı/süre bilinmiyor gösterilir. Anonim ekiplerden kesin benzersiz çalışan veya adam-saat iddiası üretilmez. Uygulama saat dilimi `Europe/Istanbul` olarak korunur.

## Cihaz ve eski kayıt uyumluluğu

V1.1 `kagu-saha-offline-v11` deposunu kullanır. Eski `kagu-saha-offline/pending-items` değiştirilmez/silinmez; açık V1 sekmesi yeni kayıtları eski senkronizasyonuyla silemez.

Eski kayıt sayısı bekleyenler ekranında görünür. Sahipliği kanıtlanamadığı için mevcut hesaba otomatik bağlanmaz. Yönetici **aynı tarayıcıda** Ziyaret ekranından, sunucunun yönetici oturumunu doğrulamasından sonra eski not/dosyaları inceleyip dosyaları cihaza kaydedebilir. Özgün proje/görev/sahibi doğrulanarak doğru hesaptan yeniden eklenir. Eski varış/ayrılışlar körlemesine uygulanmaz. Kurtarma kaynak kaydı silmez.

Pilot öncesinde eski sekmeleri kapatın, tarayıcı verilerini temizlemeyin. Kuyruk başka telefon/tarayıcıya kendiliğinden taşınmaz. Telefon kilidinde gönderim garantisi yoktur; uygulama tekrar açılınca devam eder. İnternet olmadan ilk defa sayfa açabilen tam PWA bu sürümün kapsamında değildir.

Seçimde en fazla 20 dosya, dosya başına 100 MiB ve toplam 500 MiB sınırı vardır. Video sıkıştırma/dönüştürme eklenmemiştir. Toplam süre bağlantıyla sınırlıdır; kazanç kesintide başa dönmemek ve notu bekletmemektir.

## Doğrulama

Node.js 24.15.0 ile: 53 otomatik test, typecheck, Prisma validate/generate, lint ve web+worker üretim derlemesi geçti. Lint 0 hata; mevcut img/kullanılmayan değişken/erişilebilirlik uyarıları vardır. npm audit bulgu vermedi.

```bash
npm ci
npx prisma generate
npm run prisma:validate
npm test
npm run typecheck
npm run lint
npm run build
```

Test yükleyicisi Node `registerHooks` kullanır; test/geliştirme için Node 24 önerilir. Hedef sunucunun Node/native Sharp uyumu ayrıca doğrulanmalıdır.

API testleri gerçek handler'larla sahte oturum/DB ve gerçek geçici dosyalarda; kuyruk testleri ayrı sekmeler ve fake IndexedDB'de çalışır. Canlı DB veya upload dizinine bağlanmaz. Transaction abort, kayıp yanıt, hesap değişimi, olay sırası, iki sekme, devam eden parça/finalize, commit sonrası hata, süreli temizlik, Range/HEAD, görsel yönü, ziyaret tarih/yetki/tekilleştirme, ekip snapshot'ı, legacy rapor ve hesap toplamları kapsanır.

Derleme ayrıca `NEXT_BUILD_DIR=.next-v11-check` ile yerel geliştirme çıktısından ayrılmıştır. Bu değişken normal yayında kullanılmaz. `build`, web uygulamasıyla beraber `dist/media-worker` çıktısını derler.

## Veritabanı ve worker yayını

Migration: `prisma/migrations/20260930000000_v1_1_media_and_teams/migration.sql`.
Ekip/upload tabloları ve nullable tarihsel snapshot kolonları eklenir. Eski atamalara bugünkü sayı doldurulmaz; eski raporlar değiştirilmez. Kolon/tablo silinmez. İndeks ve mevcud/boyut constraint'leri eklenir. Aktif ekip temsilcisi partial unique index'i SQL'dedir; sonraki migration'larda korunmalıdır.

Aktif kuruluma güncelleme sırası önce **ayrı test ortamında** denenmelidir:

1. DB ve `UPLOAD_DIR` birlikte yedeklenip ayrı ortamda geri yüklenir. Test ortamı canlı DB/storage kullanmaz.
2. Eski sekme/kuyruklar kontrol edilir. Birkaç gerçek personel/observer cihazı pilot seçilir.
3. Hedef Node/native paketler, disk alanı, ortak kalıcı depolama, proxy PATCH/Range ve süre sınırları doğrulanır.
4. Web/worker durdurulup doğru **test DB** üzerinde `npx prisma migrate deploy` uygulanır. Üretim adımı ayrıca yayın onayı gerektirir. Reset/seed/`admin:bootstrap` güncelleme değildir.
5. `npx prisma generate` ve `npm run build` çalıştırılır.
6. Web'e `MEDIA_WORKER_MODE=external` verilir. Worker aynı `DATABASE_URL`, `UPLOAD_DIR` ve çalışma diziniyle `npm run worker:media` üzerinden ayrı, yeniden başlayan servis olarak açılır. Komut `.env` varsa yükler; servis ortamı önceliklidir. Production worker TypeScript runtime veya development agent gerektirmez.
7. Web `npm run start` ile açılır. `fallback` yalnız worker olmadan yerel geliştirme/uyumluluk içindir.
8. Dosya İşleri paneli, cihazdaki bekleyenler, kaynak kullanımı ve sahadaki başarı gözlenir; sonra kullanıcı sayısı artırılır.

## Geri dönüş

Yeni kolon/tablo/rapor/cihaz depolarını düşürmeyin. Önce yazı trafiğini durdurup yeni/bekleyen kayıtları tespit edin ve DB+dosya yedeği alın. V1.1 istemcisi varken eski kodu körlemesine geri açmayın: eski API yeni istekleri reddedebilir, cihazda kalan FAILED kayıtlar yeni sürüm dönünce manuel tekrar deneme isteyebilir.

Worker sorunu için aynı yeni kodun fallback modu kullanılabilir; kaynaklar korunur. Veri yapısını koruyan düzeltme tercih edilir. Yedekten dönüş gerekirse yalnız trafiğe kapalı ve yeni kayıtları da koruyan planla ilerlenir.

## Yayın öncesi gerçek ortam kabul listesi

- [ ] Ayrı PostgreSQL'de mevcut migration geçmişi üzerine V1.1; eski/yeni Prisma client uyumu ve geri yükleme.
- [ ] Android Chrome/iPhone Safari: kamera, galeri, HEIC, tekrar seçme, depolama dolması.
- [ ] 64–256 kbit/sn upload, uçak modu, ekran kilidi, sekme/telefon yeniden açılması; video sırasında not/ayrılış.
- [ ] Web/worker restart, iki worker, kilit süresi dolması; ortak görevde iki personelin eşzamanlı işlemi.
- [ ] 15/16/30/31 gün, hiç ziyaret yok, arşiv, gece yarısı, observer sahipliği ve dashboard rol görünürlüğü.
- [ ] Takvim 7 sütun/6 hafta, ay/gün/drawer ve mobil liste; uzun adlar.
- [ ] Ekip 1+4; temsilci dahil/dahil değil; plan 5/fiili 3/fiili 0; ekip düzenlemesinin eski atamayı değiştirmemesi.
- [ ] Eski rapor/NULL atama, arşiv, 100'den eski rapor arama; ekran–CSV–PDF toplamları elle kontrol.
- [ ] Eski kayıt kurtarma, hesap yalıtımı, rollback sırasında cihaz kayıtlarının korunması.

Takip tarihi, ziyaret sonucu, tam observer offline ziyaret/not, timeline filtreleri ve grafikler ayrı ürün kararı olarak bırakılmıştır. Native `.xlsx` veya ayrı PDF motoru eklenmemiştir; teslim CSV ve yazdır/PDF'dir.

## Bağımlılıklar

Next.js ana sürümü 15 korunarak 15.5.26, Sharp 0.35.5 ve PostCSS/nanoid güvenlik düzeltmeleri alındı. Prisma 6 korunmuş; config'in `deepmerge` kullanımı incelenerek `deepmerge-ts` 8 override'ı eklendi, validate/generate tekrar doğrulandı. Kaynaklar: [Next.js duyurusu](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [Sharp sürüm notları](https://sharp.pixelplumbing.com/changelog/v0.35.5/), [deepmerge-ts 8](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0).
