# CI ve operasyon hazırlığı

Bu rehber yapılandırma örnekleri ve yayın kontrol sırasıdır. Dosyaları eklemek servis kurmaz, migration çalıştırmaz veya canlı ortama yayın yapmaz. Aktif V1.1 güncellemesinin veri/cihaz kabul koşulları [yayın notlarındadır](V1_1_UYGULAMA_VE_YAYIN.md). [GO_LIVE](GO_LIVE.md) yalnız ilk kurulum içindir.

## Otomatik doğrulama

`.github/workflows/ci.yml`, PR, `main` ve `codex/**` push ile manuel çalışır. Yetkisi `contents: read`; deployment yetkisi ve üretim secrets bağlantısı yoktur. Node sürümü `.node-version` içinde **24.15.0** olarak sabittir.

`verify` işi Linux'ta `npm ci → prisma generate → prisma validate → test → typecheck → lint → build` çalıştırır. URL yalnız loopback port 1'e ait sahte build tanımıdır; DB servisi yoktur. Testler kendi geçici dizinlerini kullanır. Build'in `UPLOAD_DIR` değeri `runner.temp` üzerinden yalnız **step env** seviyesinde tanımlıdır; [GitHub context tablosuna](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability) göre `runner` job env seviyesinde kullanılamaz. `build`, `.next` ile `dist/media-worker` üretir. Migration, bootstrap, worker ve gerçek dosya bakım işleri bu işte çalıştırılmaz.

`migration` işi ayrı, her çalışmada boş bir **PostgreSQL 16** service container kullanır. `scripts/test-migrations-ci.mjs`:

1. `CI=true`, `GITHUB_ACTIONS=true` ve yalnız `CI_DATABASE_URL` ister. `DATABASE_URL` veya `.env` fallback'i yoktur. Host yalnız loopback, port 5432, kullanıcı `kagu_ci`, DB `kagu_saha_ci_v11` ve schema `public` kabul edilir. Kimliği ve boş DB'yi sorguladıktan sonra ilerler; mevcut DB'yi temizlemez.
2. Önce V1.1 öncesi bütün migration'ları ayrı geçici Prisma klasöründen `migrate deploy` ile uygular.
3. Tamamen sentetik eski kullanıcı, arşiv proje, görev/atama, eski ve yeni kaynaklı ziyaret, dosya, iş kuyruğu ve SavedReport kayıtları oluşturur.
4. V1.1 migration'ını ve ikinci idempotent deploy'u çalıştırır; eski değerler/JSON, NULL snapshot'lar, partial unique index, mevcud constraint'i ve ekip değişse bile atama snapshot'ının korunmasını doğrular.

Bu script normal yerel `npm test` içine DB bağlantısı eklemez. Yerel testler yalnız target guard'ını sınar. İlk PostgreSQL/GitHub koşusu ayrıca görünür CI sonucu üretmelidir; yerel unit testlerin yeşil olması migration job'ının çalıştırıldığı anlamına gelmez. Container hedef sunucunun sürümünü, gerçek yedek geçmişini veya ağ/proxy davranışını temsil etmez; izole yedekten dönüş ve saha pilotu hâlâ gereklidir.

Action etiketleri resmî kaynaklardan doğrulanmıştır: [checkout v6](https://github.com/actions/checkout/blob/v6/action.yml), [setup-node v6](https://github.com/actions/setup-node/blob/v6/action.yml). PostgreSQL service modeli [GitHub rehberine](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) dayanır.

### Merge kontrolü

Workflow dosyası branch protection oluşturmaz. `deploy/github/main-required-checks.json`, iki işi `main` için zorunlu tutan örnektir; reviewer şartı veya kullanıcı kısıtlaması eklemez. `strict:true`, dalın güncel `main` ile test edilmesini ister. Repository admin'i GitHub'ın standart istisnasıyla bu kuralı geçersiz kılabilir; olağan merge iki başarılı kontrolü gerektirir. Mevcut protection varsa bu örnekle üzerine yazmak yerine mevcut ayar korunup yalnız required checks güncellenmelidir.

```bash
gh api repos/KaguLtd/KaguWebSaha/branches/main/protection --method PUT --input deploy/github/main-required-checks.json
```

İlk gerçek CI sonucu görülmeden bu dosya uygulanmaz. Uygulama sonucu yayın kaydında ayrıca belirtilir; repository ayarı uygulamanın çalışan sunucusunu değiştirmez.

## Paket ve kalıcı yollar

Örnekler Linux/systemd/nginx içindir; hedef sunucuya göre kullanıcı, Node yolu, domain, sertifika ve mount'ları uyarlayın. Bunlar kopyalandığında kendiliğinden kurulmaz:

- `deploy/runtime.env.example` → özel `/etc/kagu-saha/runtime.env`; gerçek değerler Git'e girmez.
- `deploy/systemd/kagu-saha-web.service` ve `kagu-saha-media-worker.service` → ayrı servisler.
- `deploy/nginx/kagu-saha.conf.example` → domain/TLS/proxy örneği.

Örnek çalışma dizini `/srv/kagu-saha/current`, Node yolu `/opt/node-v24.15.0/bin/node`, servis hesabı `kagu-saha`dır. Runtime environment dosyası servis hesabının okuyabildiği, diğer kullanıcılara kapalı dosya olmalıdır (örneğin `root:kagu-saha`, `0640`). Bootstrap şifresi rutin runtime dosyasına konmaz.

Web ve worker aynı runtime dosyasını, `DATABASE_URL`'yi ve **mutlak, kalıcı** `/var/lib/kagu-saha/uploads` yolunu kullanır. Bu dizin deployment sırasında silinmez veya geçici release klasörüne konmaz. DB+upload yedeği birlikte geri yüklenmelidir. Dosyalar nginx `alias` ile herkese açılmaz; uygulama yetki kontrolü üzerinden sunulur.

Heartbeat `/var/lib/kagu-saha/worker-health/media-worker.json` içinde, uploads dışında tutulur. Upload/health dizinlerini ve web `.next/cache` dizinini servis kurulmadan önce hazırlayın; yalnız servis hesabına yazma yetkisi verin. `.next/cache` hazırlığı hardened unit'in `ReadWritePaths` kontrolü için de gerekir. Paylaşılan storage mount'unun iki servise de hazır olması gerekir.

Hedef işletim sistemi/CPU üzerinde **tüm bağımlılıklarla** `npm ci`, `prisma generate` ve `npm run build` çalıştırın. `npm ci --omit=dev` build veya migration öncesi kullanılmaz; TypeScript/Prisma CLI bu aşamalarda gerekir. Production pruning ancak tamamlanan build/migration'dan sonra değerlendirilir. Paket `.next`, `dist/media-worker`, generated Prisma client, runtime dependencies ve runtime scriptlerini içermelidir. Windows `node_modules` klasörünü Linux'a taşımayın; Sharp/Prisma native dosyaları hedef platforma bağlıdır.

## Aktif güncelleme sırası

1. Önce ayrı ortamda DB+upload yedeğini geri yükleyin; test runtime dosyasının canlı DB/storage göstermediğini doğrulayın. Restore, migration, eski/yeni client, cihaz kuyruğu ve dosya kabulünü uygulayın.
2. Onaylı üretim penceresinde yazma trafiğini kapatıp web ve worker'ı durdurun; DB ve dosyaların aynı noktaya ait yedeğini alın. Eski sekme/kuyrukları koruyun.
3. Doğru hedefte `node --env-file=/etc/kagu-saha/runtime.env node_modules/prisma/build/index.js migrate deploy` çalıştırın. CLI'nın gösterdiği DB/host hedefini yayın kaydıyla karşılaştırın; mevcut shell environment değerleri env dosyasını geçersiz kılabildiğinden servis dışındaki override'ları da doğrulayın. Reset, seed, `db push` veya `admin:bootstrap` güncelleme adımı değildir. Partial unique index SQL migration'da korunur.
4. Hedef platformda `node --env-file=/etc/kagu-saha/runtime.env node_modules/prisma/build/index.js generate`, `npm run build` ve package hazırlığı tamamlanır. Aşağıdaki preflight çalışan servisin ortamıyla yapılandırmayı kontrol eder; DB'ye bağlanmaz:

```bash
npm run deploy:preflight -- --mode=upgrade --env-file=/etc/kagu-saha/runtime.env --worker-env-file=/etc/kagu-saha/runtime.env
```

5. Uyarlanmış systemd unit'lerini doğrulayıp worker ve web'i başlatın. Unit'ler npm ara süreci yerine Node'u doğrudan çalıştırır; SIGTERM ana worker'a ulaşır. `Restart=on-failure`, paylaşılan mount ve yazılabilir yollar tanımlıdır. Worker yeni batch almayı bırakıp mevcut batch'i bitirir. `TimeoutStopSec=180` örnek değerdir; sahadaki en uzun dönüşüme göre artırın. Zorla kesme gerekiyorsa kaynaklar/lease korunarak yeni worker'ın yeniden alması kabul testinde sınanır.
6. `/api/health` web yanıtını doğrulayın. Worker başarılı ilk batch'i tamamladıktan sonra readiness kontrolü yapın:

```bash
npm run deploy:preflight -- --mode=upgrade --env-file=/etc/kagu-saha/runtime.env --worker-env-file=/etc/kagu-saha/runtime.env --check-worker
```

7. nginx yapılandırmasını `nginx -t` ile doğruladıktan sonra kontrollü reload yapın. Gerçek proxy üzerinden PATCH/offset devamı, HEAD, video Range 206 ve geçersiz aralık 416 davranışını; kamera/HEIC ve yavaş ağ pilotunu sınayın. Servis restart'ı, logout/login ve DB/storage yedekten geri yükleme ayrı kabul kontrolleridir.

Üretim servisleri `MEDIA_WORKER_MODE=external` kullanır. Fallback yalnız yerel uyumluluk/worker kurtarma içindir; açıkça seçilen local preflight'ta `--allow-fallback` kullanılabilir, yine dedicated absolute storage gerekir.

## İlk admin ve preflight kapsamı

`upgrade` varsayılan moddur ve admin şifresi istemez. `bootstrap`, runtime değerlerine ek olarak `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME` kontrol eder; kullanıcı oluşturmaz. İlk kurulumda özel bootstrap env dosyasıyla script ayrıca bir kez çalıştırılır. Sonra bootstrap şifresi servis ortamından kaldırılır; aktif güncellemede tekrar kullanılmaz.

Environment dosyası Node'un env parser'ıyla okunur; explicit servis değişkenleri dosyayı geçersiz kılar. `--worker-env-file` ayrı dosyanın DB/upload/heartbeat tanımlarını karşılaştırır; gerçek servis yöneticisindeki ek override'ların da aynı olduğu operatör tarafından doğrulanmalıdır. Preflight credential veya bağlantı URL'si yazdırmaz; upload dizininde rastgele tek probe oluşturup kaldırır, DB sorgusu/migration yapmaz.

## Worker ve proxy izleme

Worker 15 saniyede bir private heartbeat JSON dosyasını atomik değiştirir. `state`, `lastHeartbeatAt`, `lastSuccessfulBatchAt`, son batch ve 60 saniyede bir gözlenen bekleyen iş sayısı/en eski iş tarihi vardır; kullanıcı/dosya içeriği ve credential yoktur. Bu dosya public endpoint olarak sunulmaz. Tek monitored worker örneği tasarlanmıştır; birden fazla worker izleniyorsa her süreç için ayrı heartbeat yolu kullanın ve servisleri ayrı kontrol edin.

`--check-worker`, `RUNNING`, en çok 45 saniyelik heartbeat ve 5 dakikadan yeni başarılı batch ister. Idle worker da boş batch'i başarılı sayar. Job lease heartbeat'i ile süreç heartbeat'i farklıdır. `lastSuccessfulBatchAt` yaşlanırken yalnız heartbeat'in ilerlemesi takılan batch'i gösterebilir. Kuyruk metriği son gözlem anıyla değerlendirilir; snapshot yaşı ve `oldestPendingAt` süresi artıyorsa DB, dönüşüm hataları, kaynak dosya erişimi ve worker logları incelenir. Bekleme yaşını tek başına başarısızlık olarak işaretlemeyin; backoff ve çok yavaş işler de bekleyebilir.

Nginx örneği legacy multipart için 105 MB gövde tavanı bırakır; resumable API kendi 2 MiB parça sınırını uygular. İstemci adaptif 64–1024 KiB kullanır. Body/send/read timeout'ları **hareketsizlik süresi**dir; tüm videonun tamamlanma süresi değildir. PATCH ve HEAD engellenmez, Range/If-Range/Upload-Offset korunur; private dosya yetkisi uygulamada kalır. Bu örnek upload hızını artırmaz; kesinti/yeniden başlatma davranışını hedef proxyde doğrulamak gerekir.
