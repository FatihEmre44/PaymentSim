# Payment Simulation

Bu dizindeki Express uygulaması ödeme servisinin başlangıcıdır.
`work/ledger-service` ayrı bir Ledger servisidir. İki servis kendi PostgreSQL
veritabanına ayrı bağlantı açar.

## Ödeme servisi veritabanı bağlantısı

```powershell
Copy-Item .env.example .env
```

`.env` dosyasındaki `DATABASE_URL` değerini pgAdmin'de ödeme veritabanı için
kullandığınız sunucu, port, kullanıcı, parola ve veritabanı adıyla doldurun.
Örnek dosyadaki `payment_db` adı yalnızca örnektir. Parolada `@`, `#`, `/` gibi
URL karakterleri varsa URL biçiminde kodlayın (`@` için `%40`).

```powershell
npm.cmd install
npm.cmd run db:check
npm.cmd start
```

`npm.cmd run db:check` yalnızca veritabanı adını ve kullanıcıyı okur. Sunucu
çalışırken `GET /health/db` bağlantıyı `SELECT 1` ile kontrol eder.
Bağlantı havuzu `src/database.js` içinde oluşturulur.

Ledger bağlantısı için `work/ledger-service/README.md` dosyasındaki ayrı
`.env` ve `npm.cmd run db:check` adımlarını kullanın. Auth, Approval ve Provider
servisleri henüz projede bulunmadığından onlara ait bağlantı dosyaları yoktur.
