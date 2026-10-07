# Rapor sistemi: uygulama ve kabul kaydı

6–7 Ekim 2026 · `codex/upload-timeline-release` · başlangıç commit'i `0e0fc4c`.

Bu çalışma [araştırma ve uygulama planının](RAPOR_SISTEMI_ARASTIRMA_VE_PLAN.md) raporlama kodunu uygular. Üretim ortamına yayın yapılmadı, canlı veritabanına bağlanılmadı. Üretim verisiyle sorgu planı, eşzamanlı yük ve pilot kullanım kabulü ayrı yayın kapısıdır.

## Teslim edilenler

| Rapor | Gösterilen kayıtlar / analiz |
| --- | --- |
| Proje saha faaliyeti | Görev başlıkları, yönetici notları, tarihsel atamalar, saha olayları, kanonik günlük, eski not arşivi, ziyaretler, dosyalar ve kalite bulguları |
| Personel / ekip katılımı | Günlük matris, tarihsel tür / ekip adı, plan katılımı, fiili ekip beyanı, eksik / değişen beyan ve göreve ortak süre |
| Cari saha faaliyeti | Cari / proje dağılımı, faaliyetler ve isteğe bağlı faaliyetsiz portföy |
| Ziyaret ve kontrol | Kanonik + legacy ziyaretler, bitiş günü sonuna kadarki son ziyaret ve gecikme, ziyaret ekleri |
| Operasyon özeti | Görev / varış / ayrılış, ortak süre, günlük dağılım, not / dosya / ziyaret ve sunucuda bilinen açık medya işleri |
| Veri kalitesi | Eksik tarihsel sınıf, tutarsız zaman / süre, eksik veya değişen ekip beyanı, konumsuz saha olayı ve başarısız medya işi |
| Medya / belge envanteri | Kayıt zamanına göre dosyalar, yükleyen kişi, MIME / bayt, görev / ziyaret bağı ve mevcut sunucu işi durumu |
| Dönem karşılaştırması | Aynı filtrelerle eşit uzunlukta önceki takvim dönemi, fark ve geçerli yüzde değişimi |

Rapor merkezinde tarih kısayolları, tablo arama / sıralama / sayfalama, bölüm sekmeleri ve günlük grafik bulunur. Arşiv 25 kayıtlık sayfalarda yalnız metadata taşır; tam snapshot yalnız detayda okunur. Arşiv başlık / üreten / proje araması, rapor tipi, rapor dönemiyle kesişen tarih aralığı ve üreten kişiyle süzülür.

CSV, gerçek XLSX ve tarayıcı üzerinden PDF / baskı aynı kayıtlı snapshot'ı kullanır. XLSX sayıları ve tarih alanlarını hücre türleriyle saklar; kimlik, dosya adı ve not metni tarih gibi görünse bile metin kalır. Kullanıcı metni formül olarak yazılmaz. Excel hücre sınırını aşan uzun notlar için CSV alternatifi vardır. Ekran araması veya sayfası baskıyı kırpmaz; bütün bölümler ve satırlar baskı anında hazırlanır, sonra ekran durumu geri yüklenir.

## Düzeltilen veri anlamları

- Bugünkü kullanıcı rolü, eksik tarihsel atama sınıfını tamamlamaz. Bilinmeyen sınıf açıkça gösterilir.
- Görev süresi yalnız varış / ayrılış sıralıysa ve operasyonel yuvarlama kayıtlı dakikayla eşleşiyorsa toplanır. Süre göreve ortaktır; kişisel puantaj veya adam-saat oluşturulmaz.
- Aynı ekip / gün eksik veya değişen beyan içeriyorsa ilgili günlük toplam kesin sayı gibi sunulmaz. Sıfır geçerli beyandır.
- Durum, varış ve ayrılış ayrı ölçülerdir. Otomatik tamamlanma saha ayrılışı diye gösterilmez.
- Not toplamının kaynağı `NOTE_ADDED` proje günlüğüdür. `TaskEvent` / `ProjectNote` karşılığı tekrar sayılmaz; eski proje not arşivi bağlam olarak ayrıdır.
- `ProjectVisit` ile legacy `SITE_VISITED` birlikte okunur; kanonik ziyaretin timeline karşılığı ikinci ziyaret olmaz. Ziyaret eden filtresi, başka yöneticinin aynı ziyarete eklediği kanıtı gizlemez.
- Program günü ile olay / dosya / ziyaret zamanı ayrılır. Sonradan gelen görev eki görünür; dönem dışıysa günlük dönem toplamına alınmaz.
- Okunmamış bir kaynak sıfır ölçüm gibi gösterilmez. Ziyaret ve medya toplamları rapor türüne uygundur. Göreve özel filtrelerde dönem ziyareti uygulanmaz; ziyaret raporunda okunmayan görev / varış / kapanış / süre serileri grafik ve çıktıdan çıkarılır.
- Tarihsel silinmiş kayıtların tamamı, anonim ekip üyelerinin gerçek benzersizliği ve cihazda gönderilmemiş offline veriler mevcut sunucu kayıtlarından türetilmez.

## İşleyişi koruyan sınır

Değişiklikler `lib/reports`, rapor sayfaları / API'leri, üç rapor bileşeni, rapor testleri ve bu belgelerdedir. Prisma şeması / migration, paket bağımlılıkları, ortak admin layout, auth, planlama, personel, ekip işlemleri, ziyaret kayıtları, offline protokolü, yükleme / finalize ve medya worker kaynakları değiştirilmedi.

`readReportData` rapora özel SELECT projeksiyonları kullanır. `buildReport`, ilk SQL ifadesi `SET TRANSACTION READ ONLY` olan `RepeatableRead` transaction içinde filtre etiketlerini ve kaynakları okur. Karşılaştırmanın iki dönemi aynı transaction'dadır. Okuyucu operasyonel action, rollover, worker veya yan etkili okuyucu çağırmaz. Gerçek koordinatlar ve depolama yolları snapshot'a taşınmaz; dosya bağlantıları mevcut `/api/files/:id` yetkilendirmesinden geçer.

Önizleme kayıt oluşturmaz. Kaydetme sunucuda tekrar hesaplar; önizleme fingerprint'i değişmişse 409 ile güncel sonucu gösterir ve kayıt oluşturmaz. Doğrulanan kaydetme yalnız yeni `SavedReport` oluşturur. Eski snapshot'lar yeniden hesaplanmaz veya güncellenmez. Yeni şema sürümü 3, hesap sürümü `reports-v2.0`'dır; eski sürümsüz / v2 kayıtlar okuma adaptöründe korunur. Bozuk veya bilinmeyen tablo biçimi uyarı verir.

Rapor / export API erişimi ADMIN kalır. Süresi dolmuş oturum ve diğer roller JSON 401 / 403 alır. Beklenmeyen veritabanı hata mesajı istemciye sızdırılmaz.

**Mevcut layout istisnası:** rapor sayfası ortak `AdminLayout` içinde açılırken mevcut otomatik eski görev kapatma davranışı devam eder. Bu davranış değiştirilmedi. Yeni rapor hesabı / API'sinin salt okunur olması, bütün admin sayfasının salt okunur olduğu anlamına gelmez. Kabul sırasında bu mevcut yan etki ayrı değerlendirilmelidir.

## Sınır politikası

| Sınır | Davranış |
| --- | --- |
| Kaynak başına 10.000 kayıt | DB sorgusu 10.001 kayıtla sınırlandırılır; taşma anlaşılır hatayla durur, kısmi rapor kaydedilmez |
| Atamalar | İç içe sınırsız yükleme yerine ayrı, küresel 10.001 kayıt sınırına sahip sorgu |
| Kanonik + legacy ziyaret / medya işleri | Birleşik sonuç için de 10.000 sınırı |
| Kaynak metinleri | Notlar, başlıklar, adlar, dosya ve ziyaret metni dahil 2.000.000 karakter bütçesi; kaynak okunduktan sonra denetlenir |
| Snapshot | UTF-8 8.000.000 bayt; kayıt metadata'sı eklendikten sonra tekrar denetlenir |
| Dönem | İki uç dahil en fazla 3.660 takvim günü |
| Okuma transaction'ı | En fazla 2 saniye bekleme, 15 saniye transaction süresi |
| XLSX | 64 MiB, 2.000.000 hücre, 512 bölüm ve Excel'in satır / sütun / hücre sınırları; sessiz kırpma yok |

Bu korumalar üretim performans ölçümünün yerine geçmez. Kaynak metni bütçesi SELECT'ten sonra kontrol edildiğinden çok büyük tek bir tarihsel metnin DB transferi önce gerçekleşebilir. İndeks veya şema değişikliği yapılmadı. Üretim benzeri izole veride görev / olay / dosya / atama sorguları ve eşzamanlı saha yükü ölçülmelidir.

## Doğrulama

7 Ekim 2026 yerel kabul sonuçları:

| Kontrol | Sonuç |
| --- | --- |
| Genel test paketi | 196 / 196 başarılı; başarısız, atlanan veya iptal edilen test yok |
| ESLint | 0 hata; rapor kapsamı dışında mevcut 13 uyarı; rapor kodunda uyarı yok |
| TypeScript | `npm run typecheck` başarılı; incremental kapalı |
| Prisma | `npm run prisma:validate` başarılı; şema / migration değişikliği yok |
| Üretim derlemesi | `npm run build` başarılı; Next.js web ve TypeScript medya worker derlemesi tamamlandı |
| Değişiklik izolasyonu | 12 mevcut dosya ve 14 yeni kaynak / belge / test yalnız rapor kapsamındadır; operasyonel kaynak, ortak layout, şema ve paket değişikliği yok |
| Gerçek tarayıcı kabulü | Sentetik kaynakla gerçek React bileşenleri ve üretim CSS'i; Edge / Chromium'da JavaScript hatası yok |
| PDF / baskı | 10 sayfanın tamamı görsel incelendi; 30 özet, 30 görev, 30 not, 3 kalite bulgusu, dosya ve kapalı ayrıntı dahil kaynaklar eksiksiz; boş sayfa veya kesilen uzun not yok |
| Baskı sonrası ekran | Arama değerleri, gizli sekmeler ve kapalı ayrıntılar geri yüklendi; geçici baskı tabloları kaldırıldı |
| Mobil | 390 px görünümde belge genişliği 390 px; geniş tablolar kendi içinde kaydırılıyor |
| XLSX bağımsız okuma | ZIP CRC ve openpyxl 3.1.5 ile sentetik workbook doğrulandı; Türkçe metin, hücre türleri, filtre / sabitleme ve formülsüz kullanıcı metni korundu |

PDF kabulünde yalnız DOM'da satır bulunması yeterli sayılmadı: üretilen PDF'nin metnindeki bütün beklenen kaynak kimlikleri ve uzun notun son cümlesi de doğrulandı. Baskıda sekmelerin `hidden` niteliği kaldırılır; bu, tarayıcının gizli bölümü PDF'den düşürmesini önler. Tarih, saat ve durum hücreleri okunur; ISO gibi görünen not / kimlik / dosya adı literal kalır. Tarayıcı PDF testinin altbilgisi kabul fixture'ına aittir; üründe PDF kaydı ve tarayıcı altbilgisi yerel baskı penceresinden yönetilir.

Testlerde operasyonel model mutation metotları hata fırlatan taklitlerdir; rapor kaydetme yalnız `SavedReport.create` kullanabilir. API / sorgu testleri gerçek rapor route, okuyucu ve hesap kodunu çalıştırır; canlı DB yerine sentetik projeksiyonlar kullanır. Önizleme / değişmiş fingerprint / kapalı üretim / 401–403 / aşım sınırlarında yazım yapılmadığı, eski snapshot uyumu, dönem zaman anlamları, eksik tarihsel sınıf / ekip beyanı ve çıktı güvenliği doğrulandı.

Yerel ortamda eşzamanlı genel test ve build Windows bellek tahsisi hatasıyla sonlandı. Kaynak kodu veya paket ayarı değiştirilmeden, süreçler sırayla ve geçici Node bellek sınırıyla çalıştırıldı:

```powershell
node --max-old-space-size=256 --max-semi-space-size=4 --import ./scripts/register-typescript.mjs --test --test-concurrency=1 tests/*.test.mjs scripts/tests/*.test.mjs
```

Derleme açıkça erişilemeyen yerel test DB URL'siyle, `MEDIA_WORKER_MODE=external` ve telemetry kapalı çalıştırıldı. Worker yalnız derlendi; başlatılmadı. Next.js standart ortam dosyası yüklemesini kullandı; süreçte açıkça verilen test DB URL'si korundu. `.env` içeriği inceleme için açılmadı veya çıktıya yazılmadı.

Yerelde Docker / psql bulunmadığından CI'daki izole PostgreSQL migration ve gerçek PostgreSQL personel sync senaryosu çalıştırılmadı. DB şeması değişmedi. Bu kontroller ve gerçek DB üzerindeki rapor SELECT / read-only transaction kabulü yayın zincirinde korunmalıdır.

## Yayın ve geri dönüş

Kod yerel çalışma alanında hazırlanmıştır; commit, push, migration veya deploy yapılmadı.

Yeni rapor üretimini durdurmak için rapora ait `REPORTS_NEW_GENERATION_DISABLED=true` ortam değişkeni kullanılabilir. Bu anahtar önizleme / kaydetmeyi 503 ile durdurur; eski ve yeni kaydedilmiş raporların açılmasını, CSV / XLSX dışa aktarımını kapatmaz. Ortam değişkeni üretimde uygulanmadı.

Geri dönüşte yeni üretim kapatılır, v3 okuyucusu ve kayıtlı raporlar korunur. Operasyonel DB geri alınmaz, rapor veya dosya silinmez. V3 okuyucusunu içermeyen eski sürüme dönmek yeni raporları görünmez hale getirebilir; uyumlu okuyucu korunmalıdır.

Yayın kapısı: izole üretim benzeri veriyle sorgu planı / hacim ölçümü, gerçek read-only API kabulü, saha işlemlerinde p95 / timeout / hata karşılaştırması ve yönetici pilot örnekleri. Bu çalışmada üretim yükünün etkilenmediği ölçülmüş bir sonuç olarak iddia edilmez.
