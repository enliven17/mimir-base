# Mimir x Virtuals ACP v2

Bu dosya, Virtuals Agent Commerce Protocol entegrasyonunun uygulama ve demo planidir.
Entegrasyon \`@virtuals-protocol/acp-node-v2\` kullanir. Eski \`@virtuals-protocol/acp-node\`
paketi deprecated oldugu icin kullanilmaz.

## Urun akisi

\`\`\`text
ACP buyer agent
  -> mimir_market_intelligence offering
  -> Mimir ACP seller worker
  -> Sibyl source history recall
  -> SSRF-safe source fetch + cautious LLM review
  -> ACCEPT | REVIEW | REJECT + confidence + recommended stake
  -> Sibyl persistence in mimir-virtuals tenant
  -> ACP structured deliverable
  -> buyer evaluation and USDC settlement on Virtuals ACP
\`\`\`

Sibyl karar icin zorunludur. Iki unresolvable source okumasindan sonra ayni host
fresh ACP job icin model cagrilmadan \`REJECT\` edilir. Sibyl sidecar yoksa seller
job'i fail-closed olarak reject eder.

## Kod ciktilari

| Dosya | Gorev |
| --- | --- |
| \`agents/virtuals/acp-config.ts\` | Base/Base Sepolia secimi ve secret yardimcilari |
| \`agents/virtuals/acp-assessment.ts\` | Requirement validation, gateway, LLM, Sibyl gate ve output semasi |
| \`agents/virtuals/acp-seller.ts\` | Uzun omurlu ACP v2 seller worker |
| \`scripts/virtuals-acp-demo-buyer.ts\` | Ayrı buyer/evaluator ve end-to-end demo |
| \`lib/sibyl/memory.ts\` | \`mimir-virtuals\` tenant persistence |
| \`scripts/start-workers.mjs\` | \`VIRTUALS_ACP_ENABLED=1\` ise seller worker'i baslatir |
| \`tests/node/virtuals-acp.test.ts\` | Pure input/output guvenlik testleri |

## Virtuals kayit adimlari

1. [Virtuals Service Registry](https://app.virtuals.io/acp/new) icinde seller agent
   olustur: \`Mimir Market Intelligence\`.
2. Seller agent icin EVM wallet ve signer olustur. SDK v2 \`walletId\` ve Privy
   authorization key kullanir; eski \`entity_id\` degiskeni bu entegrasyonda
   kullanilmaz.
3. Seller offering ekle:

   - Name: \`mimir_market_intelligence\`
   - Description: \`Review a prediction-market claim using its resolution source and return a Sibyl-aware risk assessment.\`
   - Price: ilk demo icin \`0.01\` veya \`0.02\` USDC
   - SLA: 30 dakika
   - Hidden/private: demo boyunca kapali/public olacak sekilde ayarla
   - Requirements JSON schema: asagidaki alanlari required yap

   \`\`\`json
   {
     "type": "object",
     "properties": {
       "claimQuestion": { "type": "string", "minLength": 8, "maxLength": 240 },
       "resolutionUrl": { "type": "string", "format": "uri" },
       "deadline": { "type": "string" },
       "requestedStakeUsdc": { "type": "number", "minimum": 0, "maximum": 10 },
       "creatorPosition": { "type": "string" },
       "counterPosition": { "type": "string" }
     },
     "required": ["claimQuestion", "resolutionUrl"]
   }
   \`\`\`

4. Ikinci, ayri bir registered wallet ile buyer agent olustur. Buyer demo
   evaluator olarak kendi wallet'ini kullanir.
5. ACP chain icin once Base mainnet (\`8453\`) kullan. Registry/test ortamı Base
   Sepolia destekliyorsa \`VIRTUALS_ACP_CHAIN_ID=84532\` secilebilir.

## Secret konfigurasyonu

Seller secret'lari yalniz Railway workers service'te tutulur. Web/Vercel env'ine
private key, wallet id veya signer key koyulmaz.

\`\`\`text
VIRTUALS_ACP_ENABLED=1
VIRTUALS_ACP_CHAIN_ID=8453
VIRTUALS_ACP_SERVER_URL=https://api.acp.virtuals.io
VIRTUALS_ACP_OFFERING_NAME=mimir_market_intelligence

VIRTUALS_ACP_SELLER_WALLET_ADDRESS=0x...
VIRTUALS_ACP_SELLER_WALLET_ID=...
VIRTUALS_ACP_SELLER_SIGNER_PRIVATE_KEY=REPLACE_WITH_VIRTUALS_SIGNER_KEY
VIRTUALS_ACP_SELLER_BUILDER_CODE=bc-...

VIRTUALS_ACP_BUYER_WALLET_ADDRESS=0x...
VIRTUALS_ACP_BUYER_WALLET_ID=...
VIRTUALS_ACP_BUYER_SIGNER_PRIVATE_KEY=REPLACE_WITH_VIRTUALS_SIGNER_KEY
VIRTUALS_ACP_BUYER_BUILDER_CODE=bc-...
VIRTUALS_ACP_SELLER_WALLET_ADDRESS=0x...
\`\`\`

`REPLACE_WITH_VIRTUALS_SIGNER_KEY` değeri Privy authorization key formatında olmalıdır; Mimir'in EOA
hex private key'i degildir. \`VIRTUALS_ACP_RPC_URL\` ve \`VIRTUALS_ACP_ENTITY_ID\`
eski v1 planiydi ve v2 worker tarafindan okunmaz.

## Local calistirma

Once Sibyl dependency'sini kur:

\`\`\`bash
pip install -r sibyl/requirements.txt
\`\`\`

Seller'i baslat:

\`\`\`bash
npm run virtuals:acp
\`\`\`

Seller \`Sibyl Memory healthy; listening for ACP jobs\` yazdiktan sonra ayri bir
terminalde buyer'i calistir:

\`\`\`bash
npm run virtuals:acp:demo
\`\`\`

Buyer requirement'ini env ile degistirebilirsin:

\`\`\`text
VIRTUALS_ACP_DEMO_URL=https://some-public-source.example/article
VIRTUALS_ACP_DEMO_QUESTION=Will this source support the claim?
VIRTUALS_ACP_DEMO_STAKE_USDC=2
\`\`\`

Ilk fresh-session demosu icin ulasilamayan ayni URL'yi iki job'da kullan:

1. Ilk job \`REVIEW\` doner ve \`UNRESOLVABLE\` Sibyl'e yazilir.
2. Seller process'ini kapatip tekrar baslat; SQLite DB'yi silme.
3. Ikinci job ayni hostta tekrar \`REVIEW\` doner ve ikinci unresolvable kaydi yazilir.
4. Ucuncu job ayni hostu Sibyl'den hatirlar, LLM'e gitmeden \`SIBYL_MEMORY_VETO\`
   ile reject olur.
5. Sonra DB'yi temizleyip ayni job'i tekrar calistir; veto yok olur. Bu, deletion
   testinin video kanitidir.

Gercek public source ile normal happy path'te buyer fonlar, seller structured
deliverable gonderir ve buyer \`complete\` ile ACP job'ini tamamlar.

## Railway

Mevcut \`scripts/start-workers.mjs\` once kalici volume'da Sibyl sidecar'i
baslatir. \`VIRTUALS_ACP_ENABLED=1\` ise ayni worker service icinde \`npm run
virtuals:acp\` ayri child process olarak calisir. Railway volume \`/data\` olmadan
Sibyl DB'si restart'ta kaybolur ve fresh-session kaniti gecersiz olur.

Required worker env:

- \`VIRTUALS_ACP_ENABLED=1\`
- ACP seller wallet/id/signer secret'lari
- \`SIBYL_MEMORY_DB=/data/sibyl/memory.db\`
- Mimir'in mevcut LLM, Base ve database env'leri

## Hackathon teslim checklist

- [x] Maintained ACP v2 SDK kullaniliyor.
- [x] Seller worker gercek ACP job lifecycle'ini dinliyor.
- [x] Offering requirement validation ve SSRF-safe fetch var.
- [x] Sibyl read/write karar critical path'te.
- [x] Fresh-session veto icin pure ve sidecar testleri var.
- [x] Base chain secimi ve buyer/evaluator demo script'i var.
- [ ] Seller Virtuals registry'de kayitli ve offering public.
- [ ] Seller ve buyer credentials ile clean sandbox job tamamlandi.
- [ ] Iki ayri process restart sonrasi ayni host veto edildi.
- [ ] ACP job transaction/hash ve Base kaniti demo videosuna alindi.
- [ ] README'de Prior Work declaration eklendi.
- [ ] 2-5 dakikalik fresh-session demo videosu cekildi.
- [ ] Demo videosu + build-log public post olarak paylasildi.

## Guvenlik notlari

- ACP signer key'leri sadece worker env'indedir ve loglanmaz.
- Requirement URL'leri \`lib/research/gateway.ts\` uzerinden gider; redirect,
  private IP, response size ve request budget kontrolleri korunur.
- Sibyl yoksa seller karar vermez ve job'i fail-closed reject eder.
- ACP sonucu dogrudan Mimir contract stake'ine donusturulmez; ilk demo sadece
  \`recommendedStakeUsdc\` onerisi ve ACP deliverable gosterir.
