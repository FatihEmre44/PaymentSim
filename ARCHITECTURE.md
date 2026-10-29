# Sanal Kurumsal Ödeme Sistemi — Ayrıntılı Mimari Taslağı

Bu belge, üzerinde uzlaşılan mimari taslağı ve mevcut kodun durumunu bir araya
getirir. **Tasarlanan** kurallar ile **uygulanmış** kod ayrı başlıklardadır.
Karar verilmemiş ayrıntılar varsayım olarak tamamlanmamıştır.

## 1. Amaç ve kapsam

- Sistem birden fazla firmanın sanal bakiyeyle ödeme talimatı oluşturduğu bir
  demodur. Gerçek para transferi ve banka entegrasyonu yapılmaz.
- Bir ödeme talimatı şirket içinde başka bir yetkili kişi tarafından onaylanır.
  Onaylanan talimat gerçek sağlayıcı yerine Provider Simulator'a gönderilir.
- Amaç ödeme yaşam döngüsünü, servis ve veritabanı sınırlarını, Kafka ile
  asenkron olaylaşmayı, tekrar teslim edilen mesajları ve belirsiz sağlayıcı
  sonuçlarını uygulamaktır.

## 2. Temel değişmezler

1. Bir kullanıcı yalnızca bir firmaya bağlıdır.
2. Ödemeyi oluşturan kullanıcı aynı ödemeyi onaylayamaz.
3. Her servis yalnızca kendi PostgreSQL veritabanına erişir.
4. Tutar TRY kuruşu olarak tam sayıdır; ondalıklı TL değeri saklanmaz.
5. Aynı firma ve `idempotency_key` için yalnızca bir ödeme oluşur.
6. Aynı `paymentId` için yalnızca bir Ledger rezervasyonu oluşur.
7. Her Ledger journal kaydındaki entry tutarları toplamı sıfırdır.
8. Süresi dolmuş onay ödemeyi yeniden açamaz.
9. Sağlayıcı sonucu belirsizse rezervasyon kesin sonuç alınmadan bırakılmaz.
10. Tekrar teslim edilen olayın iş etkisi ikinci kez uygulanmaz.

## 3. Kullanıcı, firma ve yetki modeli

- Firmaları platform yöneticisi oluşturur.
- Çalışanlar firmaya davetle katılır.
- Firma kendi rollerini ve bu rollerin izinlerini tanımlayabilir.
- Ödeme talep eden kullanıcı ile onaylayan kullanıcı farklı olmalıdır.
- Onaylayan kişinin ilgili firma için yetkili olması gerekir. Yetkinin
  User/Organization Service üzerinden doğrulanmasının yöntemi henüz seçilmedi.
- Kimlik doğrulama ile profil/organizasyon verisi farklı servislere aittir.

## 4. Servis sınırları ve veri sahipliği

| Servis | Sahip olduğu alan | Bu mimarideki görevi |
| --- | --- | --- |
| Auth Service | Giriş bilgileri, şifre hash'i, oturum/token | Kullanıcının kimliğini doğrulamak |
| User/Organization Service | Firma, profil, davet, roller ve izinler | Firma üyeliği ile yetki bilgisini yönetmek |
| Payment Service | Ödeme talebi, idempotency, ödeme durumu | Yaşam döngüsünü ve servisler arası akışı koordine etmek |
| Approval Service | Onay talebi ve karar | Onay/ret kararını ve karar meta verisini saklamak |
| Ledger Service | Hesaplar, bakiye, rezervasyon, journal/entry | Sanal para hareketlerinin tek sahibi olmak |
| Provider Simulator | Sağlayıcı işlemi ve sonucu | Dış sağlayıcıyı başarı/başarısızlık sonucuyla taklit etmek |

- Her servisin ayrı PostgreSQL veritabanı vardır. Bir servis diğerinin
  veritabanını sorgulamaz veya yazmaz.
- Servisler arası `paymentId`, `companyId` ve `userId` gibi kimlikler olaylarda
  taşınır. Ayrı servis veritabanları arasında foreign key yoktur.
- Tek bir servis veritabanının içindeki ilişkilerde foreign key kullanılabilir.
- Tablolar pgAdmin'de elle oluşturulmuştur. Uygulama mevcut tabloları kullanır;
  başlangıçta tablo oluşturma, silme veya değiştirme yapmaz.
- Mevcut kodda kök Express uygulaması Payment Service başlangıcıdır;
  `work/ledger-service` ayrı Ledger uygulamasıdır. Diğer servislerin uygulama
  dizinleri henüz yoktur.

## 5. Tutar ve ödeme kimliği

- Para birimi şu an yalnızca `TRY` olarak tasarlanmıştır.
- `amountKurus` pozitif bir tam sayıdır. Örnek: 1.250,00 TL = `125000` kuruş.
- Payment Service ödeme talebini `payments` tablosuna kaydeder.
- İstekle gelen `idempotency_key`, firma kapsamında anlamlıdır. Veritabanındaki
  `(company_id, idempotency_key)` unique kısıtı tekrar istekte ikinci kayıt
  oluşmasını önler; mevcut ödeme bulunup döndürülür.
- İdempotency anahtarının yeniden kullanımında farklı payload için nasıl
  cevap verileceği taslakta ayrıca tanımlanmadı.

## 6. Payment Service durum modeli

| Durum | Anlamı / bilinen tetikleyici |
| --- | --- |
| `RESERVATION_PENDING` | Talep kaydedildi; Ledger rezervasyon sonucu bekleniyor. |
| `PENDING_APPROVAL` | Ledger `FundsReserved` bildirdi; onay bekleniyor. |
| `APPROVED` | Yetkili kişi onayladı. |
| `REJECTED` | Onay talebi reddedildi. |
| `SUBMITTED` | Sağlayıcıya gönderim aşaması; tam geçiş noktası henüz tanımlanmadı. |
| `SUCCEEDED` | Sağlayıcıdan kesin başarı sonucu işlendi. |
| `FAILED` | Sağlayıcıdan kesin başarısızlık sonucu işlendi; yetersiz bakiye için kullanım kararlaştırılmadı. |
| `NEEDS_REVIEW` | Sağlayıcı sonucu sorgulamalardan sonra da belirsiz. |
| `EXPIRED` | Bir saatlik onay süresi doldu. |

Bilinen akış `RESERVATION_PENDING → PENDING_APPROVAL` ile başlar. Onay
sonrasında `APPROVED` olur ve `PaymentSubmitted` yayımlanır. `SUBMITTED`
durumuna tam olarak hangi adımda geçileceği taslakta netleştirilmediği için
burada kesin bir geçiş kuralı olarak yazılmamıştır. Ret `REJECTED`, onay süresi
dolması `EXPIRED`, kesin sağlayıcı sonucu `SUCCEEDED` veya `FAILED`, uzun süren
belirsizlik `NEEDS_REVIEW` ile sonuçlanır. Geç gelen onay `EXPIRED` durumunu
geri alamaz.

## 7. Approval Service

- Her ödeme için bir onay kaydı tutulur.
- Kayıt talep eden kullanıcıyı, karar veren kullanıcıyı, karar zamanını,
  karar nedenini ve bitiş zamanını içerir.
- Onaylayan kullanıcı, talep eden kullanıcıdan farklı ve firma adına yetkili
  olmalıdır.
- Talep bir saat içinde sonuçlanmazsa Payment Service ödemeyi `EXPIRED`
  yapar ve Ledger rezervasyonunu bırakacak olay üretir.
- Süre dolduktan sonra ulaşan onay ödeme durumunu yeniden açamaz.
- Ret kararı `ApprovalRejected` olayıyla Payment Service'e bildirilir.
- Onay kararının olay adı ve tam payload'ı henüz tanımlanmadı.

## 8. Ledger hesapları ve çift taraflı muhasebe

| Hesap türü | Anlamı |
| --- | --- |
| `AVAILABLE` | Harcanabilir sanal bakiye |
| `RESERVED` | Bekleyen ödemeler için ayrılmış tutar |
| `SIMULATED_OUTGOING` | Sonuçlanmış simüle dış çıkış |

1. **Rezervasyon:** `AVAILABLE` için `-amountKurus`, `RESERVED` için
   `+amountKurus` yazılır.
2. **Ret veya kesin başarısızlık:** `RESERVED` için `-amountKurus`,
   `AVAILABLE` için `+amountKurus` yazılarak rezervasyon bırakılır.
3. **Başarı:** `RESERVED` için `-amountKurus`, `SIMULATED_OUTGOING` için
   `+amountKurus` yazılarak rezervasyon sonuçlandırılır.

Örneğin kullanılabilir bakiyesi 10.000 TL olan firma 1.250 TL talimat verirse
rezervasyon journal'ında `AVAILABLE = -125000` ve `RESERVED = +125000` olur.
Journal toplamı sıfırdır. Aynı `paymentId` ile ikinci rezervasyon
`reservations.payment_id` unique kısıtıyla engellenir.

Her firmaya otomatik demo bakiyesi verilmesi kararlaştırıldı. Başlangıç tutarı
ve fonlamanın çift taraflı muhasebedeki karşı hesabı henüz belirlenmedi.

## 9. Provider Simulator ve belirsiz sonuç

- Yalnızca onaylanan ödeme için Payment Service `PaymentSubmitted` yayımlar.
- Provider Simulator bu olayı tüketir; kendi veritabanında sağlayıcı işlemi
  oluşturur ve işlemi `SUCCEEDED` veya `FAILED` olarak kaydeder.
- Sonucu `ProviderResultReported` olayıyla bildirir.
- Provider işlemi başarılı kaydetmiş olsa bile sonuç Payment Service'e
  ulaşmayabilir. Bu nedenle Payment'ın gözlemlediği sonuç geçici olarak
  belirsiz olabilir.
- Belirsizlikte Payment sağlayıcı durumunu gönderim başlangıcından itibaren
  **30. saniyede; 1., 2., 5. ve 10. dakikalarda** sorgular.
- 10. dakikadaki sorgudan sonra da sonuç bilinmiyorsa Payment `NEEDS_REVIEW`
  olur; Ledger rezervasyonu korunur.
- Sorguları çalıştıracak worker henüz seçilmedi.

## 10. Kafka, Outbox, tekrar teslim ve DLT

- Servisler arası asenkron haberleşme Kafka ile yapılır.
- Mesajların partition anahtarı `paymentId` olur; aynı ödemeye ait olaylar aynı
  partition'a yönlendirilir.
- Bir servis iş verisini yazarken yayımlayacağı olayı kendi outbox tablosuna
  **aynı veritabanı transaction'ında** kaydeder. Ayrı bir worker outbox
  kayıtlarını Kafka'ya gönderir.
- Kafka bir olayı tekrar teslim edebilir. Tüketici `event_id` değerini kendi
  `processed_events` tablosuna kaydeder; bu kayıt ve olayın iş etkisi aynı
  transaction'da yapılır. Tekrar gelen `event_id` ikinci kez uygulanmaz.
- Tüketici olay işlemesini toplam en fazla beş denemede tamamlayamazsa olay
  DLT'ye taşınır.
- DLT'ye düşen finansal olay için rezervasyonun otomatik bırakılacağı
  varsayılmaz. İnceleme, yeniden oynatma ve müdahale sorumluluğu açık karardır.
- Kafka topic adları, olay zarfının tam biçimi, retry aralıkları ve DLT
  operasyon prosedürü henüz tanımlanmadı.

## 11. Bilinen olay kataloğu

| Olay | Üreten | Bilinen amaç / tüketen |
| --- | --- | --- |
| `PaymentCreated` | Payment | Ledger'ın rezervasyon işlemini başlatır. |
| `FundsReserved` | Ledger | Payment'ı `PENDING_APPROVAL` aşamasına geçirir. |
| `ApprovalRequested` | Payment | Approval Service'de onay talebi açar. |
| `ApprovalRejected` | Approval | Payment'ın ret kararını işlemesini sağlar. |
| `PaymentRejected` | Payment | Ledger rezervasyonu bırakır. |
| `PaymentSubmitted` | Payment | Provider Simulator işlemi başlatır. |
| `ProviderResultReported` | Provider Simulator | Payment sağlayıcı sonucunu işler. |
| `PaymentSucceeded` | Payment | Ledger rezervasyonu simüle çıkışa taşır. |
| `PaymentFailed` | Payment | Ledger rezervasyonu kullanılabilir bakiyeye döndürür. |

`PaymentCreated` için bilinen payload:

```json
{
  "paymentId": "...",
  "companyId": "...",
  "amountKurus": 125000,
  "currency": "TRY"
}
```

`ApprovalRequested` için bilinen payload:

```json
{
  "paymentId": "...",
  "companyId": "...",
  "requestedByUserId": "...",
  "recipientName": "...",
  "amountKurus": 125000,
  "currency": "TRY",
  "expiresAt": "..."
}
```

Buradaki `"..."` değerleri örnektir; tarih biçimi veya kimlik şeması kararı
değildir. `event_id` tüketici tekrar koruması için gereklidir; ortak olay
zarfının tam JSON sözleşmesi henüz belirlenmedi. Diğer olayların payload'ları,
onay olayının adı ve süre dolması için yayımlanacak Payment olayının adı henüz
tanımlanmadı.

## 12. Uçtan uca ödeme akışı

1. Kullanıcı Payment Service'e ödeme isteği ve idempotency key gönderir.
2. Payment, ödemeyi `RESERVATION_PENDING` olarak kaydeder; aynı transaction'da
   `PaymentCreated` outbox kaydı oluşturur.
3. Outbox worker olayı Kafka'ya yayımlar.
4. Ledger olayı tüketir. Yeterli bakiye varsa `AVAILABLE → RESERVED`
   journal'ını ve rezervasyonu tek transaction'da kaydeder.
5. Ledger `FundsReserved` üretir.
6. Payment olayı işler, durumu `PENDING_APPROVAL` yapar ve
   `ApprovalRequested` üretir.
7. Approval Service talebi ve ardından kararı kaydeder.
8. **Ret:** Approval `ApprovalRejected` üretir. Payment `REJECTED` olur ve
   `PaymentRejected` üretir. Ledger rezervasyonu bırakır.
9. **Onay:** Payment `APPROVED` olur ve `PaymentSubmitted` üretir. Provider
   Simulator işlemi kaydeder ve `ProviderResultReported` üretir.
10. **Kesin başarı:** Payment `SUCCEEDED` olur, `PaymentSucceeded` üretir;
    Ledger `RESERVED → SIMULATED_OUTGOING` hareketini yazar.
11. **Kesin başarısızlık:** Payment `FAILED` olur, `PaymentFailed` üretir;
    Ledger `RESERVED → AVAILABLE` hareketini yazar.
12. **Onay süresi dolması:** Payment `EXPIRED` olur ve rezervasyonun bırakılması
    için henüz adı belirlenmemiş Payment olayını üretir.
13. **Sağlayıcı sonucu belirsiz:** Belirlenen zamanlarda sorgu yapılır; sonuç
    hâlâ yoksa Payment `NEEDS_REVIEW` olur ve rezervasyon tutulur.

## 13. Mevcut uygulama durumu

- Kök Express uygulamasında `GET /health` ve PostgreSQL'e `SELECT 1` gönderen
  `GET /health/db` bulunur. Payment yaşam döngüsü henüz kodlanmadı.
- Payment başlangıcı ile Ledger kendi `DATABASE_URL` ve bağlantı havuzunu
  kullanır. Her iki uygulamada `db:check` yalnızca okuma sorgusu çalıştırır.
- Ledger'da yalnızca `reserveFunds({ paymentId, companyId, amountKurus,
  currency })` use case'i uygulanmıştır. Kafka tüketicisi, outbox worker,
  rezervasyon bırakma ve sonuçlandırma işlemleri henüz kodlanmadı.
- Ledger'ın gerçek veritabanı adı `Ledger` olarak korunur. Bağlantı hedefi
  doğrulanır; uygulama DDL çalıştırmaz.
- Ledger girişi UUID `paymentId`/`companyId`, pozitif güvenli tam sayı
  `amountKurus` ve `TRY` gerektirir. UUID harfleri normalize edilir; domain para
  hesaplamaları `BigInt`, dönüşteki `amountKurus` kesin ondalık string kullanır.
- Ledger `READ COMMITTED` transaction içinde mevcut rezervasyonu önce kontrol
  eder, şirketin `AVAILABLE` hesabını `FOR UPDATE` ile kilitler, rezervasyonu
  yeniden kontrol eder ve `RESERVED` hesabını kilitler. Kilitten sonraki sorguda
  `ledger_entries` toplamından bakiye hesaplanır; toplam tek entry'nin bigint
  aralığına daraltılmaz.
- Aynı şirket ve aynı tutarla tekrarlanan `paymentId` mevcut rezervasyonu
  döndürür. Farklı şirket/tutar `RESERVATION_CONFLICT` hatası verir. Yetersiz
  bakiye `INSUFFICIENT_FUNDS` üretir ve transaction geri alınır.
- Yeni rezervasyon, `RESERVE` journal'ı, eşit ve zıt iki entry ile `ACTIVE`
  reservation kaydı olarak yazılır. Eşzamanlı `paymentId` çakışmasını
  veritabanı unique kısıtı da korur.
- Ledger kodu `src/domain`, `src/application`, `src/infrastructure/postgres`
  olarak ayrılmıştır. Messaging sınırı `src/infrastructure/messaging` altındadır;
  henüz çalışan Kafka bileşeni yoktur. Domain'deki RELEASE/CAPTURE hesaplamaları
  durum geçişi veya çalışan bırakma/sonuçlandırma akışı anlamına gelmez.
- 25 birim ve 10 gerçek PostgreSQL entegrasyon testi geçti. Entegrasyon testleri
  ayrı geçici sunucu ve `ledger_test` veritabanında çalıştı; mevcut Ledger
  verilerine yazılmadı. Eşzamanlılık, tam rollback, tekrarlar, çakışmalar ve para
  hassasiyeti doğrulandı. Kafka/offset/outbox/DLT senaryoları henüz doğrulanmadı.

## 14. Açık mimari kararlar

1. Ledger yetersiz bakiye bildirdiğinde Payment hangi nihai duruma geçecek ve
   hangi olay yayımlanacak?
2. DLT'deki finansal olaylar nasıl incelenecek, yeniden oynatılacak ve
   rezervasyon hangi koşulla bırakılacak? Müdahale sahibi kim olacak?
3. Firmaya otomatik verilecek demo bakiyesi ne kadar olacak? İlk fonlamanın
   dengeli journal kaydı için karşı hesabı hangi hesap türü olacak?
4. `FundsReserved` ve diğer olayların tam JSON payload'ları, ortak olay zarfı,
   sürümleme ve süresi dolma olayının adı ne olacak?
5. Onay yetkisi User/Organization Service'ten hangi yöntemle ve hangi zamanda
   doğrulanacak?
6. Belirsiz Provider sonucu için sorguları hangi worker çalıştıracak?
7. `SUBMITTED` durumuna kesin geçiş noktası, onay olayının adı ve çakışan
   idempotency payload'larına verilecek cevap henüz ayrıntılandırılmadı.

Bu kararlar netleşmeden ilgili akışlar için sessiz varsayımlar kodlanmamalıdır.
