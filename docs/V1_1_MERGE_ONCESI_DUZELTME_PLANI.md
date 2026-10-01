# V1.1 merge öncesi düzeltme planı

Tarih: 1 Ekim 2026. İncelenen sürüm: `codex/v1-1`, `ef96846a667a0ab082e60cae70ee883c96628c21`.

Bu belge `ef96846` üzerinden yapılan ilk incelemeyi ve kabul edilen düzeltmeleri içerir. İlk inceleme sırasında uygulama kodu değiştirilmedi. Önceki 53 test ve derleme sonucu yerel doğrulamadır; GitHub Actions doğrulaması değildir.

## Uygulama durumu — 1 Ekim 2026

Kabul edilen kod ve operasyon paketleri mevcut V1.1 dalına uygulanmıştır. Güncel doğrulama sonucu ve CI kaydı [uygulama/yayın notlarında](V1_1_UYGULAMA_VE_YAYIN.md), servis/proxy örnekleri [operasyon rehberinde](CI_VE_OPERASYON.md) tutulur. Aşağıdaki ilk bulgular düzeltme öncesi durumu anlatır.

| Paket | Teslim |
| --- | --- |
| Not güvenilirliği | JSON 401/403, kesin başarılı JSON onayı, sahipli kalıcı taslak, pending düzenlemeyi koruma, iki sekmede taslak kurtarma, gece yarısı kontrolü; hızlı not ve eski dosya gönderiminde atomik tekilleştirme |
| Upload | 64–1024 KiB uyarlanabilir parça, 128 KiB başlangıç, yaklaşık 18 sn hedef; JSON gövdesini kapsayan timeout, güvenli ACK/offset ve kullanıcıya bağlı teslim makbuzu |
| Geçmiş gönderim/okuma | Özgün görev gününden en fazla 7 günlük yeni not/medya; eski tamamlanmış makbuz yeniden okunabilir. Geçmişte yalnız kendi dosyası + aynı özgün görevde halen atama + aktif proje; GET/HEAD/thumbnail ortak kuralı ve Ayarlar'da son gönderimler |
| CI | Node 24.15.0, PR/push zinciri ve ayrı PostgreSQL 16 eski sürümden migration koruma işi |
| Operasyon | Güncelleme/bootstrap ayrımı, preflight, ayrı web/worker servisleri, private worker heartbeat/kuyruk yaşı ve nginx örneği |

Canlı migration, sunucu kurulumu veya üretim yayını yapılmamıştır. Gerçek telefon/yavaş ağ/proxy pilotu ve gerçek yedeğin ayrı ortamda geri yüklenmesi yayın öncesi kabul adımlarıdır. Repository'deki CI dosyası bir GitHub branch protection ayarı oluşturmaz; merge kontrollerinin zorunlu kılınması ayrıca repo ayarıdır.

## Karar ve öncelikler

| Konu | Değerlendirme | Çıkış koşulu |
| --- | --- | --- |
| Ziyaret/hızlı not yanlış başarı ve taslak kaybı | P0: mevcut kodda gerçek hata yolu | Merge öncesinde düzeltme ve form regresyonu |
| Parça boyutu ve yanıt zaman aşımı | P1: performans ve takılma riski | Uyarlanabilir parça, gövdeyi kapsayan timeout, devam testleri |
| GitHub Actions | P1: otomatik doğrulama eksik | Güncel commit için başarılı zorunlu kontrol |
| Migration/worker/proxy | Yayın öncesi zorunlu operasyon koşulu | Ayrı test ortamında migration ve worker/proxy kabulü |
| Geçmiş gönderim/görüntüleme | P1: açıkça belirlenmesi gereken yetki politikası | Dar kapsamlı kural, aynı GET/HEAD/thumbnail matrisi |

Mevcut kuyruk, upload oturumu, PostgreSQL iş tabloları, günlük program ve rapor mimarisi korunur. Bu işler uygulamanın yeniden yazılmasını gerektirmez.

## 1. Not kaybı — önce düzeltilecek paket

### Doğrulanan hata

- `app/api/admin/visits/route.ts:109` API için `requireAnyRole` kullanıyor. Bu yardımcı, süresi dolan/pasif oturumda JSON 401 yerine `/login` yönlendirmesi üretiyor.
- `components/admin/visit-interaction-panel.tsx:148` FormData gönderiyor; JSON okunamazsa `{}` kabul ediliyor ve yalnız `response.ok` kontrol ediliyor. `response.redirected` ve `payload.ok === true` doğrulanmıyor.
- Kurulu Next 15.5.26 kaynaklarında multipart POST için auth redirect'i 303 olabilen kod yolu var. Fetch, login HTML 200 yanıtını takip ettiğinde istemci kaydı başarılı sayıp not formunu temizleyebilir. Bu senaryo veritabanı kaydı gerektirmiyor.
- `components/admin/quick-project-note.tsx:53` aynı zayıf kontrolü kullanıyor. Yanlış başarı drawer'ı kapatıp taslağı kaldırabilir. Düzeltme iki formu da kapsamalı.
- İstek sürerken textarea düzenlenebilir. Eski metin kaydedildikten sonra gelen başarı yeni yazılan metni de `form.reset()` veya drawer kapanışıyla silebilir.

### Düzeltme

1. API içinde redirect üretmeyen oturum kontrolü kullan: oturum yok/pasif ise JSON `401 {ok:false,error}`, yanlış rol ise JSON 403. Sayfa login yönlendirmeleri aynı kalır.
2. İki formda da başarı için yönlendirilmemiş 2xx yanıt, geçerli JSON ve kesin `ok:true` şartı koy. Ziyaret oluşturma ayrıca geçerli `visitId` istemeli. Bozuk JSON, HTML 200 veya `{}` hiçbir zaman başarı sayılmamalı.
3. Hata halinde taslağı ve aynı işlemin client ID'sini koru; otomatik form temizleme, drawer kapanışı veya login'e sayfa yönlendirmesi yapma. Beklenen API redirect'ini takip etmemek için `redirect:"error"` kullanılabilir; oluşan hata taslağı silmemeli.
4. Başarıdan sonra yalnız alandaki metin gönderilen metinle aynıysa temizle. Sonradan yapılan düzenleme kalmalı. Hızlı not kapanışı da bu kurala bağlı olmalı.
5. Ziyaret/not transaction'ından sonraki `revalidatePath` hatasını ayrı ele al: yenileme hatası commit edilmiş kaydı başarısız göstermez. Normal ziyaret/not makbuzu tekrar gönderimde korunur.
6. Hızlı notun not+dosya akışını mevcut tekilleştirilmiş not işlemi ve kalıcı dosya kuyruğuna bağla. Şu an quick-note notu önce kaydedip dosyaları ayrıca işliyor; dosya hatasından sonra bütün formun yeniden gönderilmesi notu çoğaltabilir. Not ve her dosyanın sonucu açıkça gösterilmeli.
7. Yeniden giriş/sayfa yenileme sırasında da metni korumak için kullanıcı+proje+ziyaret kapsamlı yerel not taslağı önerilir. Taslak başka hesaba gösterilmez veya onun adına gönderilmez. Bu, tam observer offline ziyaret özelliğiyle aynı kapsam değildir; otomatik offline ziyaret replay'i eklenmez.

### Kabul

- Oturumsuz/pasif hesap 401, yanlış rol 403 ve sıfır iş kaydı üretir.
- Redirect/HTML 200, bozuk JSON, boş nesne ve `ok:false` taslağı/client ID'yi korur; başarı mesajı veya kapanış olmaz.
- Yanıt beklenirken değiştirilen metin, önceki metnin başarılı kaydından sonra kalır.
- Commit sonrası yenileme hatası ve kayıp HTTP yanıtında aynı ID tek not/ziyaret üretir.
- Hızlı notta tek dosya başarısızlığı notu çoğaltmaz; dosya cihazda geri bulunur.
- API testine ek olarak gerçek form/DOM davranışını sınayan en az bir regresyon testi eklenir; yalnız JSON yardımcı testi yeterli değildir.

## 2. Upload parçası — 1 MiB hedef, düşük hızda küçülme

`lib/offline/queue.ts:324` mevcut parça boyutu 128 KiB; PATCH timeout'u 120 saniye. Sunucu `lib/uploads/protocol.ts:1` ile 2 MiB kabul ediyor. 100 MiB için 800 yerine yaklaşık 100 PATCH'e inmek istek/işlem gecikmesini azaltır. Bu, bağlantının bant genişliğini artırmaz ve kesinti sonrası tekrar gönderilecek onaylanmamış kısmı büyütür.

| Upload hızı | 128 KiB teorik aktarım | 1 MiB teorik aktarım |
| --- | --- | --- |
| 64 kbit/sn | 16,4 sn | 131,1 sn |
| 128 kbit/sn | 8,2 sn | 65,5 sn |
| 256 kbit/sn | 4,1 sn | 32,8 sn |
| 0,5 Mbit/sn | 2,1 sn | 16,8 sn |

Süreler `bayt × 8 / bit/sn` hesabıdır; HTTP gecikmesi/kayıp dahil değildir. 64 kbit/sn hızda sabit 1 MiB mevcut 120 saniyeyi aşar. Bu yüzden yalnız sabiti büyütmek uygun değildir.

Önerilen uygulama:

- İlk küçük parçayla ölçüm; uygun bağlantıda kademeli olarak 1 MiB'a çıkış. Başlangıç 128 KiB, alt sınır 64 KiB, üst sınır 1 MiB; parça başına yaklaşık 15–20 saniye hedefi.
- Başarılı tam yanıt süresinden ölçüm, kontrollü büyüme; zaman aşımı/kopmada küçülme. Ağ bilgisi API'si zorunlu tutulmaz.
- Değişen parça boyutu aynı upload kimliği ve sunucunun onayladığı bayt konumuyla devam eder. Belirsiz ACK'den sonra konum yeniden sorgulanır; yeni session/generation yalnız mevcut süre dolması/yeniden seçme kurallarıyla açılır.
- **Ek hata:** `boundedFetch` zamanlayıcısı başlıklar geldiğinde temizleniyor; ardından `response.json()` beklemesi kapsam dışında. Timeout bütün yanıt gövdesini okumayı da kapsamalı.
- Tek aktif medya aktarımı, kısa olay önceliği, kullanıcı sahipliği, kalıcı blob ve tek finalize korunur.

Kabul: 64/128/256 kbit/sn ve 0,5 Mbit/sn, yüksek RTT, parça ortası kopma, commit sonrası kayıp ACK, boyut değişimi, init/PATCH/finalize sırasında 401 ve başlık sonrası takılan JSON. Doğrulanmış baytlar kaybolmaz; dosya/timeline tek oluşur. Simülasyon performans iddiası için yeterli sayılmaz; gerçek proxy üzerinden saha denemesi yapılır.

## 3. CI — yerel doğrulamayı tekrar edilebilir hale getirme

Bu dalda `.github/workflows` yok. İlk iş akışı `.github/workflows/ci.yml` olarak eklenir:

1. PR'lar, `main` ve `codex/**` push'ları ile elle çalıştırma.
2. GitHub-hosted Linux runner; yerel testle eşleştirilmiş Node 24.15.0; lockfile üzerinden npm cache ve `npm ci`.
3. `npx prisma generate` → `npm run prisma:validate` → `npm test` → `npm run typecheck` → `npm run lint` → `npm run build`.
4. `build` web ile beraber `dist/media-worker` üretimini zaten kapsar. Testler geçse bile worker derlenmiyorsa kontrol başarısız olur.
5. İlk job yalnız sahte, geçerli biçimli `DATABASE_URL` ve test ortamı değerlerini kullanır. Canlı secrets, migration, bootstrap, deploy veya çalışan worker bu job'a eklenmez. DB'siz kontroller canlı servise ihtiyaç duymamalı.
6. Aynı dalın eski koşularını iptal eden concurrency; yalnız `contents:read`; süre sınırı ve başarısızlıkların açık görünmesi. Kontroller `continue-on-error` ile yeşile çevrilmez.
7. PR'daki güncel commit için gerçek başarılı Actions run'ı görülmeden “CI geçti” denmez. Merge için bu kontrolün zorunlu tutulması önerilir; branch rule ayrı repo ayarıdır.

Prisma validate/generate gerçek PostgreSQL migration denemesi değildir. Yayın öncesi ayrıca geçici/ayrı PostgreSQL üzerinde başlangıç migration'ları + temsilî tarihsel kayıtlar + V1.1 migrate deploy denemesi yapılır. Eski satırlar, snapshot JSON, nullable alanlar, index/constraint'ler ve FK davranışı doğrulanır. Bu daha sonra bağımsız bir CI integration job'ına taşınabilir; canlı DB kullanmaz.

## 4. Yayın — kod hatasından ayrı zorunlu iş paketi

Migration ve bağımsız worker gereksinimi doğru. `MEDIA_WORKER_MODE=external` web'deki fallback işlemesini kapatıyor; worker açılmazsa web çalışırken dönüşüm/önizleme/temizlik işleri bekleyebilir. Sadece `/api/health` yanıtına bakmak yeterli değildir: mevcut endpoint yalnız web'in yanıt verdiğini gösteriyor.

Hazırlanacak teslimler:

- Mevcut aktif kuruluma güncelleme belgesi ve ilk kurulum belgesi açıkça ayrılır. Eski `docs/GO_LIVE.md` reset/ilk-admin adımlarını içeriyor; başına aktif V1.1 güncellemesi için yayın notlarına yönlendirme eklenir.
- Sunucuya uygun process manager için ayrı web/worker servis örnekleri: çalışma dizini, aynı sürüm, otomatik yeniden başlatma, kontrollü durdurma, log ve kaynak sınırları. Kullanılan sunucu/servis yöneticisi uygulanırken doğrulanır.
- Aynı `DATABASE_URL`, aynı **mutlak, kalıcı** `UPLOAD_DIR` ve dosya izinleri. Çok makinede aynı dizin adı aynı fiziksel depolama değildir; ortak depolama gerekir. Worker derlenmiş çıktı ve gerekli runtime/native bağımlılıklarla teslim edilir.
- Kurulum öncesi web/worker Node ve Sharp uyumu, DB+dosya yedeğinin ayrı ortamda geri yüklenmesi, yeterli disk, V1.1 migration denemesi.
- `deploy-preflight` mevcut admin-bootstrap değişkenlerini zorunlu tutuyor. Aktif güncelleme kontrolü ilk-admin gereksiniminden ayrılır; worker modu/runtime/derlenmiş dosya ve gerçek depolama denetlenir. Hassas env değerleri loglanmaz.
- Proxy örneğinde PATCH/POST gövde sınırı, request buffering ve süreleri ile Range/If-Range/HEAD geçişi açıklanır. `serverActions.bodySizeLimit` API/proxy sınırını tek başına belirlemez. İlgili uçlar gerçek proxy üzerinden denenir.
- Worker'ın durması/restart edilmesi/iki kopya çalışması, PENDING işin tamamlanması ve başarısız kaynakların korunması test edilir. Bekleyen iş yaşı ve son tamamlanan iş/worker canlılığı izlenir; web sağlık kontrolüyle karıştırılmaz.

Yayın sırası: ayrı ortamda kabul → yedek ve bakım aralığı → uygulama/worker durdurma → additive migration → doğrulanmış sürüm/derlenmiş worker kurulumu → servisler → küçük cihaz pilotu → yaygın kullanım. Reset, seed ve admin bootstrap aktif güncellemenin adımı değildir. Canlı yayın bu planın hazırlanmasıyla otomatik yapılmaz.

## 5. Geçmiş dosya — erişimi dar tutan ürün kararı

Doğrulanan fark:

- Upload yetkisi `lib/uploads/server.ts:34` ile geçmiş veya bugünkü atanmış görevi kabul eder.
- Dosya GET/HEAD (`app/api/files/[fileId]/route.ts:37`) ve thumbnail (`app/api/files/[fileId]/thumbnail/route.ts:31`) bugünkü proje atamasını ister.
- Dünkü video bugün tamamlandığında personel bugün aynı projede atanmadıysa dosya sunucuda durur fakat kendi isteği 403 alabilir. Görev detay ekranı da yalnız bugünü açar; yalnız dosya API'sini değiştirmek geçmişe erişim bağlantısı sağlamaz.
- Okuma sorgusunu basitçe `taskDate <= today` yapmak geçmişte atanılan tüm projelerin başkalarına ait dosyalarını da açar. Önerilmez.

Önerilen dar politika:

1. Bugünkü proje atamasından gelen mevcut okuma yetkisi korunur.
2. Geçmiş için yalnız **dosyayı yükleyen kullanıcı + dosyanın bağlı olduğu özgün görev + o görevde halen doğrulanan atama** istisnası değerlendirilir. Proje genelinde geçmiş okuma hakkı verilmez. Geçmiş istisnasının arşiv projelerde uygulanması ayrıca kararlaştırılır; ilk öneri aktif projelerle sınırlı olmasıdır.
3. Aynı yardımcı GET, HEAD ve thumbnail'da kullanılır; Range farklı yetki sağlamaz. Aktif oturum, başka hesap, kaldırılan atama ve admin/observer kapsamı test edilir.
4. Personel Ayarlar'da küçük bir “son gönderim sonucu” bağlantısı/metadata kaydı, bu dar görüntüleme hakkını kullanılabilir yapar. Genel geçmiş görev veya proje tarayıcısı eklenmez.
5. **Ayrı politika açığı:** geçmiş not/medya gönderimi şu anda herhangi bir geçmiş göreve açıktır; 7 günlük olay sınırı NOTE/upload'a uygulanmıyor. Özgün görev tarihi esas alınarak 7 gün gecikmiş kabul önerilir, fakat bu bir ürün kararıdır. Daha eski cihaz kayıtları silinmeden yönetici incelemesinde kalmalı. İstemci zamanı gerçek çekim/kayıt zamanını tek başına kanıtlamaz; mevcut session TTL de toplam geçmiş gönderim sınırı değildir.

Kabul: dün atanmış/bugün atanmamış kişinin kendi dosyası; başka kişinin dosyası; bugünkü atama; hiç atama yok; kaldırılan atama; arşiv; GET/HEAD/thumbnail/Range tutarlılığı. Seçilecek gecikme sınırında son gün/ertesi gün ve sınırı aşan yerel kaydın korunması test edilir.

## Uygulama sırası

1. CI iskeleti ve not kaybı paketini küçük commit'lerle hazırlama; iki formun yeni regresyonlarını çalıştırma.
2. Upload boyutu/timeout paketi; mevcut offset/tek finalize testlerini koruma ve düşük hız senaryolarını ekleme.
3. Geçmiş gönderim/görüntüleme kararını netleştirip ortak yetki yardımcıları ve dar sonuç bağlantısını uygulama.
4. Güncel commit için Actions'ın tam zincirini doğrulama; yayın belgeleri ve sunucuya uygun servis/proxy örneklerini hazırlama.
5. Ayrı PostgreSQL, gerçek proxy ve Android/iPhone üzerinde kabul; sonra küçük pilot ve kontrollü yayın.

Merge için en az not kaybı düzeltmesi, ilgili regresyonlar, gövde timeout düzeltmesi ve güncel başarılı CI zorunlu kabul edilir. Yayın için ayrıca migration/worker/proxy ve gerçek cihaz kabulü gerekir. Performans/erişim kararları tamamlanmadan ilgili alanlar tamamlandı sayılmaz.

## Teknik kaynaklar

- [MDN Response.redirected](https://developer.mozilla.org/en-US/docs/Web/API/Response/redirected): yanıtın redirect ile geldiğinin tespiti ve istek aşamasında `redirect:"error"`.
- [Next.js redirect](https://nextjs.org/docs/app/api-reference/functions/redirect): redirect'in kontrol akışını kesmesi ve HTTP yönlendirme davranışı. Multipart 303 yolu ayrıca kurulu 15.5.26 kaynaklarında incelendi.
- [GitHub Actions Node.js](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs): Node sürümü seçimi, lockfile ile `npm ci`, cache ve build/test iş akışı.
