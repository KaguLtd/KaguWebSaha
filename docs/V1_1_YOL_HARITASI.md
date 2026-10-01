# Kagu Saha V1.1 — inceleme ve yol haritası

Tarih: 30 Eylül 2026. Durum: çekirdek yükleme/kuyruk/worker, ziyaret, takvim, ekip ve rapor işleri `codex/v1-1` dalında uygulandı. Canlı migration/yayın yapılmadı. [Uygulama ve yayın notları](V1_1_UYGULAMA_VE_YAYIN.md) test sonuçlarını ve gerçek ortamda kalan kabul kontrollerini içerir. Aşağıdaki inceleme bulguları başlangıç sürümüne aittir.

## 1. GitHub ve yerel çalışma alanı

- Depo: [KaguLtd/KaguWebSaha](https://github.com/KaguLtd/KaguWebSaha).
- GitHub varsayılan dalı: `main`.
- Yerel `HEAD`, yerelde kayıtlı `origin/main` ve GitHub üzerinden anlık okunan `main` aynı: `7c7d2ffcd1be2838a0452a18dc416d995e1199c9`.
- Son commit: [Fix personnel form submission payload](https://github.com/KaguLtd/KaguWebSaha/commit/7c7d2ffcd1be2838a0452a18dc416d995e1199c9), 18 Temmuz 2026.
- İnceleme başlangıcında takip edilen kaynak dosyalarında staged/unstaged fark yoktu. Yalnız önceden mevcut, takip edilmeyen `tsconfig.tsbuildinfo` derleme önbelleği vardı; değiştirilmedi/silinmedi.
- Bu belge inceleme sonunda yeni yerel dosya olarak eklendi. Commit/push yapılmadı.

Bu doğrulama kaynak kodunun eşitliğini gösterir. Canlı sunucuda hangi commit'in çalıştığı, uygulanmış migration'lar, proxy sınırları ve üretim verisinin durumu ayrıca doğrulanmalıdır.

## 2. İnceleme kapsamı ve doğrulamalar

Next.js/React ekranları, API ve server action akışları, oturum/roller, günlük görevler, personel gönderimleri, ziyaretler, raporlar, kullanıcı yönetimi, Prisma modeli/migration'ları, dosya depolama ve arka plan işleri, tarih yardımcıları ve işletim dokümanları incelendi. Kritik alanlar üç paralel incelemeyle karşılaştırıldı.

| Kontrol | Sonuç |
| --- | --- |
| GitHub `main` ile yerel commit | Aynı |
| Takip edilen kaynak dosyalarının farkı | Yok |
| `tsc --noEmit --incremental false` | Başarılı |
| `npm run prisma:validate` | Başarılı; veritabanına veri yazmaz |
| `npm run lint` | Tamamlanamadı: ESLint yapılandırma seçimi istiyor, exit 1 |
| Otomatik regresyon test altyapısı | Test komutu/yapılandırması bulunmadı; manuel kabul dokümanı var |
| Üretim, telefon kamera testi, gerçek düşük bağlantı testi | Bu incelemede yapılmadı |

`.env` içeriği ve yüklenen kullanıcı dosyaları okunmadı; DB verisi sorgulanmadı/değiştirilmedi. Migration, seed, bootstrap, sıkıştırma veya onarım script'i çalıştırılmadı. Çalışan ortamı etkileyebilecek build/deploy yapılmadı.

## 3. Güncellemenin sınırları

V1.1 mevcut Next.js/PostgreSQL/Prisma yapısına küçük ve geri alınabilir eklemelerle ilerler.

- Kullanıcı hesapları, proje ID'leri, mevcut notlar/dosyalar ve timeline geçmişi korunur.
- Günlük programlama, drawer ile atama, aynı gün birden fazla görev, mevcut görev durumları ve atama kilidi korunur.
- Varış/ayrılış, not ve dosya ekleme aynı ekranlardan yapılmaya devam eder.
- OBSERVER/PERSONNEL/ADMIN rollerinin ürün kapsamı genişletilmeden erişim tutarsızlıkları giderilir.
- Mevcut kaydedilmiş raporlar değişmeden açılır; yeni hesaplamalar sürümlenir.
- Muhasebe, stok, CRM, hakediş ve kişiye özel puantaj bu sürümün kapsamına alınmaz.
- Büyük framework sürüm geçişi, bulut depolama veya yeni kuyruk platformu bu taleplerin ön koşulu değildir.

## 4. Öncelik 1 — personel gönderimleri ve dosya işleri

### Kodda doğrulanan durum

| Bulgu | Kaynak | Etki |
| --- | --- | --- |
| Personel gönderimi kalıcı kuyruğa kaydedilmiyor; internet yoksa hata dönüyor | `components/personnel/offline-task-forms.tsx:55`, `lib/offline/queue.ts:5` | Kamera sonrası sekme yenilenirse/bağlantı koparsa gönderimin devamı güvence altında değil. Mevcut kuyruk yalnız ziyaret dosyaları için. |
| Not ve bütün ekler tek multipart XHR'da gönderiliyor | `components/personnel/offline-task-forms.tsx:132`, `app/api/offline/sync/route.ts:378` | Büyük video notun kaydını da bekletiyor; kesintide bütün paketi tekrar gönderme gerekiyor. |
| Fotoğraf için tarayıcı sıkıştırması var, HEIC/video bu sıkıştırmadan geçmiyor | `lib/client/image-compression.ts:3`, `:59` | Önceki geliştirmeler korunmalı; video upload'u ayrıca ele alınmalı. |
| Dosya başına 100 MB kontrolü var; dosya sunucuda bütünüyle belleğe alınıyor | `lib/files/storage.ts:211`, `:216` | Çoklu/büyük dosyalarda bellek ve toplam istek boyutu riski. `serverActions.bodySizeLimit` API/proxy sınırlarını tek başına çözmez. |
| HEIC ve thumbnail DB kaydı tamamlandıktan sonraki hata, üretilmiş kalıcı dosyayı silebilir | `lib/files/heic-conversion-jobs.ts:181`, `:223`, `:225`; `lib/files/image-thumbnail-jobs.ts:232`, `:257`, `:258` | Veritabanında dosya kaydı varken fiziksel dosyanın bulunmaması mümkün. Bu bir kod yolu bulgusudur; üretimde gerçekleşme sıklığı ölçülmedi. |
| İşler web isteği üzerinden tetikleniyor; başarısız işler otomatik yeniden denenmiyor | `lib/files/heic-conversion-jobs.ts:83`, `:120`; `lib/files/image-thumbnail-jobs.ts:91`, `:128` | Bağımsız, dayanıklı worker yaşam döngüsü eksik. |
| İşlem başında tüm PROCESSING işler PENDING yapılıyor | `lib/files/heic-conversion-jobs.ts:106`, `lib/files/image-thumbnail-jobs.ts:114` | Birden fazla süreç varsa hâlâ çalışan işler yeniden alınabilir. Üretimde süreç sayısı doğrulanmalı. |
| Video indirme bütün dosyayı belleğe alıyor; Range desteği yok | `app/api/files/[fileId]/route.ts:66` | Video açma/ileri sarma ve eşzamanlı kullanım ayrıca iyileştirilmeli. |

18 Temmuz'a kadar yapılan düzeltmeler form verisinin disabled olmadan alınması, not doğrulaması ve gönderim akışını sadeleştirme içeriyor. Eski kodu olduğu gibi geri getirmek yerine bu düzeltmelerin üstüne kalıcı ve tekilleştirilmiş gönderim eklenmeli. README/ayarlar/kabul testi hâlâ personel offline desteği anlatıyor; uygulamayla birlikte güncellenmeli.

### Aşama 1A — kayıt kaybını ve belirsiz sonucu önleme

1. HEIC/thumbnail işlerinde dosya üretme, DB commit, geçici dosya temizliği ve ekran yenilemeyi ayrı hata sınırlarına ayır. Commit edilmiş bir dosya temizleme/yenileme hatasında silinmesin.
2. Personel notunu ve seçilmiş dosyaları önce kullanıcıya ait kalıcı yerel taslağa/kuyruğa kaydet. Kaydetme başarıyla gerçekleşmediyse “cihaza kaydedildi” mesajı verilmesin.
3. Kuyruk kayıtlarını kullanıcı ID'siyle ayır; hesap değişince başka kullanıcının taslağı gösterilmesin veya onun adına gönderilmesin.
4. Not kaydını medya aktarımından ayır. Aynı Kaydet düğmesi korunabilir: kullanıcı “Not kaydedildi, 2 dosya bekliyor” gibi doğru sonucu görsün. Sahadan ayrılma için mevcut not zorunluluğu medya bitmesini bekletmesin.
5. Not, olay, dosya ve finalize işlemlerinde aynı client ID'nin tekrar gönderimi aynı sonucu döndürsün; tekrar not/timeline/dosya oluşmasın. Yalnız düğmeyi disable etmek yeterli değildir.
6. Tek dosyanın hatası diğer dosyaları ve kısa olayları bekletmesin. Küçük not/olay işlemlerine öncelik ver; büyük medya aktarımı sınırlı eşzamanlılıkla çalışsın.
7. Dosya boyutu, dosya sayısı ve toplam yükleme boyutu seçim anında kontrol edilsin. Bağlantı yok, oturum süresi doldu, boyut/tür reddi, depolama dolu ve sunucu hatası birbirinden ayrılan Türkçe mesajlar alsın. Tekrar dene/iptal seçeneği ve dosya başına durum gösterilsin.
8. Kameradan çekme ve galeriden seçme ayrı anlaşılır kontroller olsun; önizleme, yanlış fotoğrafı kaldırma ve tekrar çekme ekle. Mevcut JPEG sıkıştırması ve HEIC tanıma davranışı korunsun.
9. Önceki sürümlerden IndexedDB'de kalmış personel kayıtları varsa görünmez bırakılmasın. Kuyruk sürümü/migration stratejisiyle listelenip güvenli devralınsın; bu kayıtlar tespit edilmeden eski store temizlenmesin. Eski kayıt kullanıcı ID'si içermiyorsa sahipliği/görev erişimi doğrulanmadan mevcut hesaba bağlanıp otomatik gönderilmesin; eski varış/ayrılış olayları tamamlanmış görevi yeniden açacak şekilde körlemesine tekrar uygulanmasın.
10. Mevcut ziyaret dosya kuyruğu 400/404/413/422 cevaplarında kaydı siliyor (`lib/offline/queue.ts:244`). Hatalı dosya kaydı kullanıcı karar verene kadar görünür kalsın; retry/dosyayı yeniden seç/cihazdan kaydet/sil seçenekleri sunulsun. Aynı cihazda hesap değişimi ve iki sekmenin aynı kaydı göndermesi de ele alınsın.

Tarayıcı depolamasının kota ve temizlenme sınırları vardır. Yerel kayıt sunucuya teslimle aynı değildir; uygulama kota hatasını ele almalı ve iki durumu açık göstermelidir. Dayanak: [MDN depolama kotaları](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

### Aşama 1B — düşük hızda devam edebilen yükleme

- Dosya aktarımı için yükleme oturumu, küçük parçalar, sunucuda doğrulanmış ilerleme ve tek finalize işlemi ekle. Kesintide yalnız eksik kısım gönderilsin.
- İlk teknik değerlendirme: [tus devam edebilir yükleme protokolü](https://tus.io/protocols/resumable-upload) veya aynı davranışı sağlayan sınırlı bir upload API'si. Kütüphane/altyapı seçimi mevcut sunucu ve depolama koşulları doğrulandıktan sonra yapılır.
- Parça boyutu ve eşzamanlılık gerçek saha bağlantısı/proxy süre sınırıyla ayarlanır; başlangıç denemesi 0,5–2 MB parça ve tek aktif medya aktarımıdır, kesin ürün limiti değildir.
- Gönderilen bayt oranı, sunucuya teslim, HEIC dönüşümü ve önizleme hazırlığı farklı durumlar olarak gösterilir. %100 aktarım “önizleme hazır” demek değildir.
- Oturum yenilendiğinde/sekme geri açıldığında güvenli kaldığı yerden devam. Telefon ekranı kapalıyken tarayıcının çalışmayı sürdürmesi garanti sayılmaz.
- Kısmi upload temizliği süreli ve güvenli olmalı; tamamlanmış veya kuyruktaki geçerli dosyaları silmemeli. Upload oturumu, her parça ve finalize için sahiplik/proje-görev yetkisi doğrulanmalı.
- Video indirme streaming ve HTTP Range desteklemeli; mevcut dosya erişim kuralları korunmalı. Dayanak: [MDN Range istekleri](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests).

Sunucuda video sıkıştırmak telefondan sunucuya giden ilk upload'u hızlandırmaz. Gerekirse kısa klip/daha düşük kayıt kalitesi seçeneği cihazlarda ayrıca denenir; tarayıcıya ağır bir video dönüştürme zorunluluğu getirilmez. Örneğin 50 MB dosya, 0,5 Mbit/sn upload ile teorik olarak yaklaşık 13 dakika 20 saniye sürer; gerçek süre daha uzayabilir. Esas hedef kesintide başa dönmemek ve not kaydını bekletmemektir.

### Aşama 1C — dayanıklı arka plan işleri

- Mevcut PostgreSQL iş tabloları ve depolama ile bağımsız worker çalıştır; web süreci restart olsa da PENDING işler ilerlesin. Yeni altyapı servisi zorunlu tutulmasın.
- İşlerin kilit sahibi, kilit süresi, son çalışma zamanı, deneme sayısı ve sonraki deneme zamanı olsun. Yalnız kilidi süresi dolan işler kurtarılsın.
- Geçici hatada aralığı artan tekrar deneme; kalıcı hatada anlaşılır durum ve yönetici tekrar denemesi.
- Worker ile web aynı upload depolamasına erişsin. Çok süreçli/çok sunuculu kurulum varsa depolama ve kilit modeli buna göre doğrulansın.
- Yönetici için hata/iş kuyruğu özeti: bekleyen, işlenen, başarısız ve yaşlanan işler. Dosya içeriği veya not metni loglara taşınmasın.
- Mevcut başarısız/kırık dosyalar önce salt okunur sayılır. Kaynak dosyası mevcut olan kayıtlar için ayrı, kontrollü onarım hazırlanır; toplu silme/yeniden işleme kendiliğinden yapılmaz.

### Kabul ölçütleri

- Android Chrome ve iPhone Safari'de kamera/galeri, JPEG/HEIC, birden fazla fotoğraf, not+video ve dosya iptali doğrulanır.
- 0,25/0,5/1 Mbit/sn bağlantı, kısa kopma, 30 saniye kopma, sekme yenileme/telefon kilidi ve oturum bitmesi senaryolarında yerel kaydı doğrulanmış veri geri bulunur.
- Dosya aktarımı kesilince onaylanmış parçalar yeniden gönderilmez; not ikinci kez oluşmaz.
- Aynı işlem iki sekmeden/tekrar gönderimde tek kalıcı kayıt ve doğru timeline üretir.
- Dün alınmış taslak ertesi gün doğru göreve gider. Olay zamanı ile senkronizasyon zamanı ayrılır; geçmiş göreve gönderim yetkisi sınırsız açılmaz.
- Varış → not → ayrılış sırası, gece yarısı ve otomatik kapanmış görevle çakışma için kurallar tanımlanır. Kuyruk geri gelince eski görevi tekrar ON_SITE yapmaz.
- Worker restart ve iki worker'ın aynı işe talip olması dosya/olay çoğaltmaz. Commit sonrası temizlik/yenileme hatası başarılı dosyayı silmez.

## 5. Ziyaret modülü

### İstenen çekirdek

Proje adına küçük bir ziyaret simgesi; tooltip/metin olarak son ziyaret tarihi, geçen gün ve ziyaret eden kişi. Hem mobil hem masaüstü listelerinde tutarlı çalışır.

| Son ziyaretin üzerinden geçen takvim günü | Gösterim |
| --- | --- |
| 0–15 | Normal durum |
| 16–30 | Turuncu |
| 31 ve üzeri | Kırmızı |
| Hiç ziyaret yok | Öneri: gri + “Henüz ziyaret edilmedi” |
| Arşiv proje | Gecikme uyarısından çıkar; geçmiş korunur |

“15 günden uzun” ve “30 günden fazla” sınırları bu şekilde uygulanır. Hiç gidilmemiş projeleri açılış tarihinden turuncu/kırmızıya yaşlandırma alternatif bir ürün kararıdır. İlk öneri ayrı gri durum ve ayrı filtredir.

Dashboard'da **Dün Yapılanlar** bölümünün hemen altına **Bugün Ziyaret Edilenler** eklenir. Proje/cari, ziyaret eden, saat, kısa not, dosya sayısı ve detay bağlantısı bulunur. “X şantiye / Y ziyaret” ayrımı yapılır; bir projeye iki ziyaret iki şantiye sayılmaz. Genel not/dosya yüklemek yeni ziyaret sayılmaz. ADMIN bütün yetkili ziyaretleri, OBSERVER mevcut kendi kayıt kapsamına uygun özeti görür.

### Mevcut temel ve küçük düzeltmeler

- `ProjectVisit` ve `(projectId, visitedAt)` indeksi mevcut: `prisma/schema.prisma:279`. Liste son ziyareti çekmiyor: `app/(admin)/admin/visits/page.tsx:34`. Dashboard'a yeni blok ekleme yeri: `app/(admin)/admin/page.tsx:134`.
- Eski programa bağlı `SITE_VISITED` yolu yalnız task/timeline olayı oluşturabiliyor: `app/api/admin/daily-tasks/route.ts:350`. Sadece yeni `ProjectVisit` tablosunu okumak geçmiş ziyaretleri dışarıda bırakabilir. Güvenli veri kopyasında kullanım ölçülmeli; gerekiyorsa `projectVisitId=null` eski timeline ziyaretleriyle salt okunur ortak görünüm oluşturulmalı. Yeni ziyaretin timeline karşılığı tekrar sayılmamalı.
- Ziyaret notu formu sonucu beklemeden sıfırlanıyor: `components/admin/visit-interaction-panel.tsx:278`. Hata halinde taslak korunmalı; yalnız başarılı kayıt sonrası temizlenmeli.
- Bugünkü ziyaret yalnız son 20 kayıttan bulunuyor: `app/(admin)/admin/visits/[projectId]/page.tsx:77`. Kullanıcının bugünkü ziyaretini ayrı sorgulama ve gece yarısında state güncelleme gerekli.
- API ziyaret ID/proje eşleşmesini kontrol ediyor, observer sahipliği ayrıca kontrol edilmiyor: `app/api/admin/visits/route.ts:75`. İzin matrisiyle uygun sahiplik kontrolü eklenmeli.
- Ziyaret kaydı tekrar gönderimde tekilleştirilmeli; aynı gün ikinci gerçek ziyaret ile aynı işlemin tekrar gönderimi ayrılmalı.
- Gün sınırı, dashboard, rapor ve renk hesapları uygulamanın mevcut `Europe/Istanbul` saat dilimini kullanmalı. Bilgisayarın saat dilimi uygulamaya sessizce taşınmamalı.

### Seçilecek ek fikirler

- 30+ gün, 16–30 gün ve hiç ziyaret edilmedi filtreleri; uzun süredir gidilmeyenleri sıralama.
- Observer'a “Bugün ziyaret ettiklerim” kısa listesi ve son ziyaret notuna hızlı erişim.
- Ziyaretin sonucu: normal / takip gerekli; küçük takip notu ve isteğe bağlı sonraki ziyaret tarihi.
- Ziyaret geçmişinde “daha fazla yükle”; mevcut son 20 kayıt sınırını aşan geçmişe erişim.
- Çevrimdışı ziyaret işaretleme/not desteği ayrıca seçilebilir. Mevcut observer kuyruğu yalnız dosya içindir; eklenirse gerçek ziyaret tarihi ile senkronizasyon tarihi ayrılmalıdır.

Kabul: 15/16/30/31 gün, hiç ziyaret yok, arşiv, aynı projede çoklu ziyaret, tarihsel kayıtlar, gece yarısı, hata sonrası notun kalması, rol ve dosya erişimi test edilir.

## 6. Günlük programlama / takvim

Mevcut masaüstü hücresi 144 px, iç görev listesi 96 px, proje adı 12 px ve tek satır kesiliyor: `components/admin/schedule-drawer-calendar.tsx:147-193`.

- Hücreyi yaklaşık 180–200 px, iç listeyi yaklaşık 130–150 px yaparak başlangıç görsel karşılaştırması hazırlanır.
- Proje adını iki satıra sar; tam ad tooltip ve drawer'da görünür kalsın.
- Font zaten 12 px. Önce alan/satır iyileştirmesi; gerekirse 11–12 px arasında karşılaştırma. Gereğinden fazla küçültme okunabilirliği azaltabilir.
- Yedi sütun, altı hafta, ay/gün seçimi, görev tıklama, drawer, iç kaydırma ve ayrı mobil haftalık liste korunur.
- 768/1024/1440 px ekranlar, uzun isimler, aynı günde 1/5/10 görev ve kaydırma sırasında yanlış tıklama doğrulanır. DB migration gerekmez.

## 7. Kullanıcılar / ön tanımlı taşeron ekipleri

Bu temel, yeni işgücü raporlarından önce kurulmalı.

### Önerilen ilk sürüm

Kullanıcılar içinde **Ön Tanımlı Ekipler**: ekip adı, mevcut tek PERSONNEL taşeron temsilcisi, hesabı olmayan ek kişi sayısı, temsilcinin çalışan sayısına dahil olup olmadığı ve aktiflik.

Örnek: “Temsilci: Ahmet; hesabı olmayan ek personel: 4; temsilci dahil: evet; toplam: 5 kişi”. Temsilci sahada çalışmıyorsa dahil işareti kapatılabilir. Toplam her zaman formda açık görünür. Hesapsız kişiler için yapay login hesapları açılmaz.

- Mevcut `DailyTaskAssignee.userId` giriş/erişim yetkisini taşımaya devam eder; temsilci aynı personel ekranını kullanır.
- Günlük atamada ekip seçilir; görevde ekip ID'si, ekip adı, temsilci ve sayı anlık kopyası saklanır. İşçi/taşeron/saha kontrol sınıflaması da görev tarihinde saklanır; sonradan rol değişikliği geçmiş günün yeni rapor hesabını değiştirmez.
- Ekip sayısını bugün değiştirmek önceki görevin sayısını değiştirmez. Geçerlilik tarihi/sürüm ve gelecekteki planları güncelleme kuralı belirlenir.
- Planlanan sayı ile sahada beyan edilen sayı ayrı tutulur. Taşeron için mevcut varış ekranında önceden doldurulmuş sayı alanı veya yönetici doğrulaması kullanılabilir; bu etkileşim onay aşamasında seçilir.
- Ekip ve temsilci aynı atamada seçilirse temsilci iki kez sayılmaz. İlk sürümde temsilci bir aktif taşeron ekibine bağlı olur.
- ON_SITE/COMPLETED görevlerde mevcut atama kilidi korunur. Sayı düzeltmesi gerekiyorsa yönetici açıklama ve değişiklik kaydıyla yapar; eski SavedReport tekrar hesaplanmaz.
- Ekip pasifleştirilince geçmiş görev/rapor bağlantısı korunur; eski personele varsayılan olarak bugünkü taşeron sayısı geriye uygulanmaz.

### Gerçek sayı konusunda sınır

5 kişilik aynı ekip aynı gün iki projeye giderse 10 proje katılımı oluşabilir, ancak bu 10 benzersiz çalışan demek değildir. Aynı ekip/gün tekrarları toplam işgücü beyanında tekilleştirilir; farklı proje katılımları ayrıca gösterilir. Hesapsız kişilerin kimliği bilinmediğinden şirket çapında kesin benzersiz çalışan sayısı ispatlanamaz; rapor açıkça “beyan edilen ekip mevcudu” der.

Bir ekibin aynı gün bölünmesi veya kişi sayısının gün içinde değişmesi ek bir ürün kararıdır. İlk sürümde bölünmüş ekipler gerekiyorsa ayrı tanımlanır; kimliği bilinmeyen üyelerden kesin kişisel puantaj üretilmez. Aynı ekip/gün mevcudu değişirse rapor değişen beyanı/aralığı gösterir; rastgele toplam veya maksimum kesin çalışan sayısı olarak sunulmaz.

Kabul: 1+4=5; ekip+temsilci yine 5; yarın 7 olan ekip geçmişte 5 kalır; iki projedeki katılım ve ekip/gün toplamı karışmaz; giriş/yetki/görev akışı korunur.

## 8. Raporlar — görünüm ve hesabı birlikte geliştirme

### Kodda doğrulanan hesap sorunları

- `app/api/admin/reports/route.ts:55` tüm görev durumlarını alıyor; planlanan ve gerçekleşen işler ayrılmıyor.
- Aynı dosyada `:69` ve `:73` “Adam-gün” görev atamalarının toplamı. Bu tanım aynı kişinin/ekibin aynı gün birden fazla göreve atanmasında çift sayım üretir. “Saha günü” de görev sayısı olarak kullanılıyor.
- Observer takvimden görev açınca kendisi atanabiliyor (`app/api/admin/daily-tasks/route.ts:90`). İşgücü hesabında saha kontrol ile çalışan personel/ekip ayrılmalı.
- Varış/ayrılış/süre alanları kişiye değil göreve ait (`prisma/schema.prisma:199`). Bunlardan kesin kişisel adam-saat türetilemez.
- Otomatik gün kapatma yalnız COMPLETED yapıyor (`lib/tasks/rollover.ts:13`). Ayrılış/süre eksikliği sıfır çalışma olarak sunulmamalı; tamamlandı durumu tek başına fiili çalışmayı kanıtlamaz.
- Kaydedilmiş raporların son 100'ü listeleniyor; sayfalama yok. Proje seçimi yalnız aktif projelerden: `app/(admin)/admin/reports/page.tsx:14-15`.

### İlk kapsam

| Rapor | İçerik |
| --- | --- |
| Proje saha özeti | Planlanan/başlayan/tamamlanan görevler, saha günleri, personel/ekip katkısı, ziyaretler, not/dosya detay bağlantıları |
| Personel / ekip | Görevlendirme, gidilen proje/gün, plan ve fiili beyan, taşeron mevcudu, ölçülmüş/eksik görev süresi |
| Cari | Projeler, gerçekleşen saha günleri, görev ve ekip katkısı |
| Ziyaret | Ziyaret eden, tarih, son ziyaret, 15/30 gün durumu, not/dosya ve gecikmiş aktif projeler |

- Tarih, proje, cari, personel/ekip, taşeron, görev durumu ve aktif/arşiv filtreleri.
- Önce önizleme, sonra kaydet; özet toplamları görünür yap, satırdan mevcut proje/görev/ziyaret detayına git.
- CSV/Excel dışa aktarım ve yazdırılabilir PDF. Önce okunaklı tablo ve toplamlar; grafikler isteğe bağlı ikinci adım.
- Kayıtlı rapor arama/sayfalama; arşiv projelerden rapor üretme.
- Ziyaret raporları da yeni ProjectVisit ve gerekiyorsa tarihsel SITE_VISITED kaynaklarını aynı tekilleştirilmiş okuma üzerinden kullanır.
- Ekran, kayıt ve çıktılar aynı hesaplama katmanını kullanır; tarih/saat uygulama saat dilimine bağlıdır.
- Yeni raporda veri/hesaplama sürümü, kullanılan filtreler, oluşturma zamanı ve eksik veri işaretleri saklanır. Mevcut `SavedReport.snapshot` değiştirilmeden okunur.

"Adam-gün"/"adam-saat" için metrik tanımı rapor ekranında net olmalı: proje katılımı, hesaplı kişi/gün, beyan edilen ekip/gün ve görev süresi ayrı değerlerdir. Ortak süreyi ekip mevcuduyla çarpmak ancak birlikte çalışıldığı varsayımıyla tahmini adam-saat olabilir. Geçmişte bulunmayan ekip mevcudu veya kanıtlanamayan işgücü sınıflaması “bilinmiyor”/eski hesap sürümü etiketiyle gösterilir; bugünkü sayı/rolden tahmin edilmez.

Kabul: PLANNED gerçekleşmiş iş değildir; observer işgücünü artırmaz; eksik süre 0 değildir; aynı kişi/ekip tekrarları doğru ayrılır; eski rapor değişmez; arşiv ve 100'den eski rapor bulunur; çıktı toplamları ekranla aynıdır.

## 9. Genel incelemeden çıkan sınırlı ek işler

### V1.1 doğrulama/sağlamlık çalışmasına dahil edilmesi önerilenler

1. **Yetki matrisi tutarlılığı.** Observer takvimde personel/yönetici notunu görmezken dashboard bazılarını gösterebiliyor. Genel proje detayı arşiv projeye erişimi ayrıca engellemiyor; ziyaret/dosya yolları engelliyor. Dashboard/ziyaret sahipliği/proje/dosya kapsamı birlikte test edilir. Ürün kapsamını genişletmeden mevcut niyet uygulanır.
2. **Süresi dolmuş oturum.** `lib/auth/session.ts:70` render sırasında `destroySession()` üzerinden cookie silebiliyor. Next.js cookie değiştirmeyi Server Action/Route Handler ile sınırlar; süresi dolan/pasifleştirilmiş hesap düzgün login yönlendirmesiyle ele alınmalı. Bu kod riski cihaz/üretim tekrar testiyle doğrulanır.
3. **Kontrollü yayın ve yedek geri yükleme denemesi.** DB ve upload dosyaları birlikte korunur; canlı kopyadan ayrılmış test ortamında migration/geri dönüş denenir.
4. **Kritik regresyon testleri.** Tam ürün test sistemi yazmak yerine yükleme/tekrar gönderim, rol erişimi, tarih sınırı, ekip snapshot ve rapor toplamı testlerine odaklanılır. ESLint yapılandırması tamamlanır; eski manuel kabul dokümanı gerçek akışa uyarlanır.
5. **Hata teşhisi.** Başarısız yüklemenin hangi aşamada kaldığı, HTTP durumu, bayt boyutu/süre ve iş ID'si görülebilir olur; kullanıcı dosya içeriği ve notları loglanmaz.

### Kullanıcının gerek var/yok diye seçebileceği ek ürün işleri

| Öneri | Kazanç | İlk görüş |
| --- | --- | --- |
| Ziyaret gecikme filtreleri ve öncelik sırası | Observer hangi şantiyeye gitmesi gerektiğini hızla görür | V1.1 için faydalı |
| Ziyaret sonucu / takip notu / sonraki ziyaret tarihi | Kaydın sonraki aksiyonu görünür olur | İsteğe bağlı |
| Proje timeline tarih/tür filtreleri ve daha fazla yükleme | Eski fotoğraf/not daha kolay bulunur; sayfa hafifler | İsteğe bağlı |
| Observer için offline ziyaret/not | Bağlantısız sahada kayıt korunur | Personel yüklemesi düzeldikten sonra seçilebilir |
| Dönem karşılaştırma grafikleri | Yönetici eğilimleri görür | Rapor hesapları doğrulandıktan sonra |

## 10. Teslim sırası ve çıkış kapıları

| Aşama | İş paketi | Tamamlanma koşulu |
| --- | --- | --- |
| 0 | Sürüm/sunucu sınırlarını doğrula, ayrı test verisi, mevcut akışların başlangıç ölçümü, metrik/ekip kararları | Canlı veri korunuyor; sorun ölçülebiliyor; sayım tanımları yazılı |
| 1 | Fotoğraf/not dayanıklılığı, commit sonrası iş hataları, kalıcı kullanıcıya bağlı kuyruk, tekilleştirme | Kamera/bağlantı kopması/tekrar gönderim testleri geçiyor |
| 2 | Devam edebilir video/dosya aktarımı, bağımsız worker, hata/ilerleme, streaming | Düşük hız ve restart testleri geçiyor; büyük dosya notu engellemiyor |
| 3 | Ziyaret renkleri, dashboard özeti, ziyaret taslak/sahiplik düzeltmeleri; küçük takvim düzenlemesi | Tarih/rol/geçmiş kayıt ve mevcut takvim testleri geçiyor |
| 4 | Ön tanımlı ekipler, görevde tarihsel sayı, plan/fiili beyan | Mevcut personel akışı ve geçmiş veri korunuyor; çift sayım yok |
| 5 | Yeni rapor hesabı, önizleme, filtre, dışa aktarım, arşiv | Eski snapshot aynı; örnek raporlar elle hesapla eşleşiyor |
| 6 | Ayrı test ortamında genel regresyon, küçük personel/observer pilotu, kademeli yayın | Kritik hata yok; geri dönüş ve kuyruk uyumluluğu denenmiş |

Takvim görsel düzenlemesi düşük riskli ayrı bir değişiklik olarak daha erken teslim edilebilir. Ekip/işgücü raporları arasındaki bağımlılık korunmalı. Takvim süresi/kesin bitiş tarihi üretim koşulları ve seçilecek ek kapsam ölçülmeden verilmemeli.

### Canlı kullanımı koruma

- Her iş paketi küçük PR ve ayrı kabul kontrolüyle ilerler; ilk yeni branch varsayılanı `codex/` olur.
- Schema değişiklikleri ekleyici/geriye uyumlu başlar; kolon silme, tarihsel kayıtları topluca yeniden hesaplama veya veri sıfırlama yapılmaz.
- Yeni kuyruk, rapor ve ekip özellikleri kademeli açılır. Eski açık sekmelerin/IndexedDB kayıtlarının yeni sürümle uyumu sınanır.
- Geri dönüş, yeni kabul edilmiş kayıtları kaybetmeden özellik kapatma/önceki kodu kullanma yoluyla denenir. Eski API'nin yeni istemci kuyruğunu reddetmesi ayrıca ele alınır.
- Yayın önce az sayıda gerçek cihaz/kullanıcıyla gözlenir; başarılı yükleme oranı, bekleyen kuyruk yaşı ve iş hataları başlangıç ölçümüyle karşılaştırılır.
- Her aşamada giriş → atama → varış → not/dosya → ayrılış → timeline → rapor akışı doğrulanır. Otomatik kapanış ve saat dilimi kuralları sessizce değiştirilmez.

## 11. Ürün kararları

Planın uygulanmasına geçmeden önce netleştirilecek seçimler:

1. Hiç ziyaret edilmemiş projeler ayrı gri durum mu olsun, açılış tarihinden itibaren turuncu/kırmızı mı yaşlansın? Öneri: gri + ayrı filtre.
2. Taşeron temsilcisi çalışan sayısına dahil mi? Öneri: varsayılan dahil, ekip formunda açık seçim ve hesaplanan toplam.
3. Fiili ekip mevcudu nerede doğrulansın? Öneri: yalnız taşeron varışında önceden doldurulmuş küçük alan; alternatif yönetici doğrulaması.
4. İlk rapor çıktıları: Excel/CSV ve yazdırılabilir PDF öneriliyor. Kurumsal tasarımlı ayrı PDF şablonu gerekirse ikinci adım.
5. 9. bölümdeki ek ürün önerilerinden hangileri V1.1'e alınacak?

Kodda görülen sorunlar ile üretimde kesin nedeni henüz kanıtlanmamış kamera/proxy/bellek/süre aşımı sorunları ayrıdır. İlk saha testi ve hata ölçümü, cihaz/ortam kaynaklı kalan nedenleri belirleyecektir.
