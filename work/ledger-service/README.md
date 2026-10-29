# Ledger Service

Bu dilim, kesinleşmiş kurallarla PostgreSQL üzerinde çalışan `reserveFunds`
işlemini içerir. Üç para hareketinin domain hesaplaması hazırdır; bırakma ve
sonuçlandırmanın application işlemleri ile HTTP/Kafka henüz uygulanmamıştır.
Yeni iş davranışları veya şema önerileri onaylanmış kabul edilmemiştir.

## Kurulum

```powershell
cd work\ledger-service
npm.cmd install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

`.env` içindeki `DATABASE_URL` değerini kendi PostgreSQL bağlantınızla
doldurun:

```text
DATABASE_URL=postgresql://postgres:PAROLANI_BURAYA@localhost:5432/Ledger
```

`.env` Git'e eklenmez. Ledger Service mevcut `public.ledger_accounts`,
`public.journal_transactions`, `public.ledger_entries` ve
`public.reservations` tablolarını kullanır; tablo oluşturmaz, silmez veya
değiştirmez.

Bağlantı adresindeki `postgres` kullanıcı adı, `localhost` sunucu adresi,
`5432` portu ve `Ledger` veritabanı adı pgAdmin'deki bağlantı bilgilerinizle
aynı olmalıdır. Parolada `@`, `#`, `/` gibi URL karakterleri varsa bunları URL
biçiminde kodlayın (örneğin `@` için `%40`).

Bağlantıyı kontrol etmek için:

```powershell
npm.cmd run db:check
```

Başarılı olursa veritabanı adı yazdırılır. Bu komut yalnızca
`SELECT current_database()` çalıştırır. Bağlantı adresi ve hata ayrıntılarındaki
parolalar çıktıya yazılmaz. Veritabanının adı büyük/küçük harf dahil `Ledger`
olmalıdır; başka bir hedef hem bağlantı ayarında hem transaction başlamasında
reddedilir. `.env`, çalışma dizinine göre değil Ledger Service dizininden okunur;
mevcut süreç ortamındaki `DATABASE_URL` daha önceliklidir.

`npm.cmd start` bağlantıyı doğrular, mevcut kapsamı bildirir ve pool'u kapatıp
çıkar. Henüz sürekli çalışan HTTP/Kafka sunucusu değildir. Uygulama giriş noktası
`src/index.js`, `reserveFunds`, `pool` ve `close` dışa aktarır. Programatik
kullanımda işlem sonunda `await close()` çağrılmalıdır.

## `reserveFunds` akışı

`reserveFunds({ paymentId, companyId, amountKurus, currency })` sözleşmesi:

- `paymentId` ve `companyId` standart UUID metinleridir; harfler küçük harfe
  normalize edilir. TRY zorunludur.
- Giriş tutarı pozitif JavaScript güvenli tam sayısıdır
  (`1..Number.MAX_SAFE_INTEGER` kuruş). Ondalık, string, bigint ve güvenli aralığı
  aşan giriş reddedilir; bu, mevcut giriş türünün korunmasıdır.
- Hesaplamalar `BigInt`, PostgreSQL parametreleri kesin ondalık metin kullanır.
  Dönen rezervasyondaki `amountKurus` her zaman string'dir. Toplam bakiye tek
  entry'nin bigint sınırını aşsa da SQL'de daraltılmaz.

İşlem sırası:

1. Girdiyi doğrula; `READ COMMITTED` transaction aç ve hedef DB adını doğrula.
2. Mevcut ödeme rezervasyonunu hesap aramadan önce kontrol et. Aynı istek için
   mevcut sonucu döndür; farklı şirket/tutar için `RESERVATION_CONFLICT` ver.
3. `AVAILABLE` hesabını `FOR UPDATE` ile kilitle; beklerken oluşmuş olabilecek
   rezervasyonu yeniden kontrol et. Ardından `RESERVED` hesabını kilitle.
4. Kilitten sonraki ayrı sorguda bakiye toplamını oku. Yetersizse
   `INSUFFICIENT_FUNDS` ile rollback yap; muhasebe hareketi bırakma.
5. Domain'de şirket, para birimi, hesap yönü ve sıfır toplamı doğrulanan
   `RESERVE` journal'ını ve `ACTIVE` rezervasyonu aynı transaction'da yaz.
6. Eşzamanlı farklı şirket taleplerinde yalnızca doğrulanmış
   `reservations_payment_id_key` unique ihlalini yakala. Kaybeden transaction'ın
   tamamını geri aldıktan sonra yeni transaction'da kazanan kaydı oku ve
   şirket/tutar eşleşmesini değerlendir. Diğer unique hatalarını gizleme.

Bütün bakiye yazıcıları aynı hesap kilidi protokolüne uymalıdır; uygulama
dışından doğrudan SQL yazılması bu kilit güvencesini sağlamaz. Commit sonucu
belirsiz hatalar otomatik yeniden çalıştırılmaz; aynı ödeme kimliğiyle yeniden
çağrı mevcut kaydı bulur. Rollback/commit sırasında bozulan bağlantı pool'dan atılır.

Yetersiz bakiye için yeni bir olay veya kalıcı başarısız ödeme sonucu eklenmedi.
Bu davranışlara ilişkin kararlar açık kalır.

## Kod yapısı

- `src/domain/`: `ReservationPolicy` giriş/tekrar/bakiye kurallarını;
  `money.js` kesin tutar doğrulamasını; `journal.js` RESERVE, RELEASE ve CAPTURE
  hareket yönleri ile journal dengesini yönetir. DB/Kafka bağımlılığı yoktur.
- `src/application/reserve-funds.js`: `ReserveFunds` iş akışını yönetir.
  SQL veya pg client yerine transaction'a bağlı repository'leri kullanır.
- `src/infrastructure/postgres/`: `PostgresTransactionManager` transaction ve
  bağlantı yaşam döngüsünü; `AccountRepository` hesap kilidi/bakiyeyi;
  `ReservationRepository` rezervasyon erişimini; `JournalRepository` hazır
  journal'ın SQL yazımını; `database.js` pool ve DB hedef kontrolünü yönetir.
- `src/infrastructure/messaging/`: kesinleşmiş kurallar ve açık bağımlılıklar
  README'de kayıtlıdır. Çalışan consumer/publisher/outbox worker henüz yoktur.
- `src/index.js`: bağımlılıkların bir araya geldiği giriş noktasıdır.

## Testler

```powershell
npm.cmd test
$env:PG_BIN = 'C:\Program Files\PostgreSQL\18\bin'
npm.cmd run test:integration
```

`PG_BIN`, PostgreSQL'in `initdb` ve `pg_ctl` araçlarının klasörüdür; araçlar PATH
üzerindeyse verilmesi gerekmez. Node.js 24 ve PostgreSQL 18.6 ile doğrulandı.

Entegrasyon aracı `.env`/`DATABASE_URL` kullanmaz. `.test-runtime/` altında yeni
bir PostgreSQL kümesi başlatır, yalnızca 127.0.0.1 üzerinde boş bir port seçer ve
sunucunun gerçek veri dizinini doğruladıktan sonra ayrı `ledger_test` DB'sini
oluşturur. `test/fixtures/ledger-schema.sql`, 28 Ekim 2026'da okunmuş mevcut
şemanın test kopyasıdır; migration veya uygulama başlangıç DDL'i değildir.
Mevcut `Ledger` tablolarına veri yazılmaz ve mevcut veriler temizlenmez.

Test fonlaması yalnızca yapay, dengeli bir başlangıç verisidir. Ürün için demo
bakiyesi, fonlama karşı hesabı veya tetikleyici kararı oluşturmaz.

Test sonunda geçici sunucu kapatılır; tanılama için veri dizini ve log saklanır,
`.gitignore` ile dışlanır. Windows kısıtlı yürütme ortamı PostgreSQL başlangıcını
engellerse testler izin verilen yerel terminalde çalıştırılmalıdır.

Doğrulanan sonuç: **25 birim testi ve 10 gerçek PostgreSQL entegrasyon testi**.
Entegrasyon senaryoları: dengeli rezervasyon, yetersiz bakiye, eşzamanlı/sonraki
tekrarlar, şirket/tutar çakışması, bakiye aşımı yarışı, şirketler arası ödeme
yarışı, ilk entry sonrası hata, rezervasyon yazımı sonrası hata, büyük tutar
hassasiyeti ve yanlış DB hedefinin reddedilmesi.

## Açık kapsam

- Bırakma/sonuçlandırma application akışları: durum geçişleri ve çelişen veya
  bulunamayan rezervasyon davranışı kesinleşmedi. Yalnızca önceden belirlenen
  muhasebe yönleri domain'de kodlandı; mevcut rezervasyon durumları değiştirilmedi.
- Kafka, outbox, processed_events entegrasyonu ve DLT: olay sözleşmeleri ve
  gerekli şema eklemeleri bekliyor. Mevcut DB'de outbox yok. Kafka entegrasyonu,
  olay tekrarları, offset/outbox kapanma senaryoları ve beş deneme/DLT davranışı
  uygulanmış veya test edilmiş sayılmaz.
- Demo fonlaması, kalıcı yetersiz bakiye sonucu, payload özeti, yeni trigger ve
  diğer öneriler uygulanmadı. Mevcut şema değiştirilmedi.
- Payment, Approval, Auth ve Provider servisleri bu çalışma kapsamında değil.

Başlangıç kaynak/test yedeği proje kökündeki
`backups/ledger-service-20261028-222652/` dizinindedir; `manifest.json` SHA-256
özetlerini içerir. Gizli `.env` yedeğe kopyalanmadı ve yerinde korundu.
