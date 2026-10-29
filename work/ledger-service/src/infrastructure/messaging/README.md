# Messaging boundary

Kafka bağlantısı, consumer, publisher ve outbox worker bu dizine ait olacak.
Henüz çalışan bir consumer veya Kafka bağımlılığı yoktur.

Kesinleşmiş kurallar: paymentId mesaj anahtarı, Ledger'a ait consumer group,
aynı transaction içinde processed_events + muhasebe/rezervasyon + outbox,
DB commit sonrası offset ve teknik hatalarda toplam en fazla beş deneme.

Olay zarfı/payload'ları, yetersiz bakiye olayı, süre dolması olayının adı,
topic'ler, retry aralıkları, DLT inceleme/yeniden oynatma politikası ve gerekli
şema eklemeleri onaylanmadan bu sınır canlı mesaj tüketmeye başlamayacak.
Kafka yerine doğrudan yayın veya yalnızca bellekte outbox uygulanmaz.
