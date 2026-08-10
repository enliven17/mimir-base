# Mimir: BOT Chain'den Base Sepolia'ya Migration Planı

Tarih: 2026-08-10

## 1. Hedef ve kapsam

Mimir'in tek desteklenen ağı Base Sepolia olacak. BOT Chain'e ait chain tanımı,
RPC/explorer/faucet adresleri, BOT para birimi, USDT isimleri ve özel HTTP 402
protokolü koddan tamamen kaldırılacak.

Hedef para modeli:

- Gas: Base Sepolia ETH.
- Market stake, payout ve ajan bankroll'u: Base Sepolia test USDC.
- API/ajan ödemeleri ve revenue: x402 v2 üzerinden test USDC.
- Zincir: Base Sepolia, chain ID `84532`, CAIP-2 kimliği `eip155:84532`.
- USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimals.

Bu bir in-place zincir yükseltmesi değildir. Mevcut sözleşme upgradeable olmadığı ve
chain state zincirler arasında taşınamadığı için Base Sepolia'ya yeni kontrat deploy
edilecek. BOT Chain state'i, deploy bilgileri ve test verisi taşınmayacak veya repo
içinde arşivlenmeyecek. Yeni uygulama temiz Base Sepolia state'iyle başlayacak ve
hiçbir çalışma zamanı fallback'iyle BOT Chain'e bağlanmayacak.

## 2. Mevcut durum özeti

Kod incelemesinde 81 dosyada yaklaşık 1.050 BOT Chain/BOT/USDT/özel ödeme izi
bulundu. En önemli gerçek, README ve `docs/AGENTS.md` güncel olmamasına rağmen
kontratın stake tarafında zaten ERC-20 kullandığıdır:

- `contracts/Mimir.sol` stake ve payout için 6-decimal `IERC20 usdt` kullanıyor.
- `lib/usdt.ts` BOT Chain test USDT adresini sabitliyor.
- `lib/botchain.ts` chain 968, RPC, explorer, log tarama ve viem client'larını
  merkezi olarak yayıyor.
- `lib/paid-client.ts` ve `lib/paid-server.ts` x402 değildir. Native BOT transferi,
  `X-Payment-Tx` ve manuel transaction doğrulaması kullanan özel bir HTTP 402
  protokolüdür.
- `payments.amount_bot DOUBLE PRECISION` revenue muhasebesini BOT ve floating-point
  sayıya kilitliyor.
- Ajan bonusları ile fonlama scriptleri native BOT transfer ediyor; market stake'leri
  ise USDT kullanıyor.
- Frontend, docs, mesajlar ve testlerde BOT/USDT/BOTScan isimleri geniş biçimde
  hard-code edilmiş.

## 3. Hedef mimari

```text
Kullanıcı / Base Account
  -> wagmi + baseSepolia
  -> approve(USDC) + create/challenge (mümkünse wallet_sendCalls batch)
  -> Mimir.sol (USDC escrow ve payout)

Oracle / Creator / Council ajanları
  -> Base Sepolia viem client
  -> USDC stake işlemleri
  -> x402 buyer client (PAYMENT-SIGNATURE)

Next.js ücretli endpoint'leri
  -> @x402/next + @x402/evm
  -> x402 facilitator verify/settle
  -> USDC doğrudan seller/persona adresine
  -> settlement sonucu -> Neon payment ledger -> /revenue
```

Testnet başlangıcında signup gerektirmeyen `https://x402.org/facilitator`
kullanılabilir. Production benzeri test ve gelecekte Base mainnet için CDP
facilitator yapılandırması hazırlanmalı; facilitator URL ve kimlik bilgileri env'den
gelmelidir.

## 4. Uygulama fazları

### Faz 0 — Temiz başlangıç guardrail'leri

1. Repo içindeki BOT Chain deploy/state bilgisini migration girdisi olarak kullanma;
   eski zincir verisini taşıyan branch, JSON/CSV snapshot veya runtime adapter üretme.
2. Base Sepolia için boş Neon veritabanı/şeması aç veya mevcut test tablolarını kontrollü
   biçimde sıfırla. Claim, challenger, sync metadata ve payment satırları Base'e eski
   network verisi taşımadan `0` noktasından başlamalı.
3. CI'a son aşamada çalışacak yasaklı-terim kontrolü ekle:
   `botchain|BOT Chain|bohr.life|chain 968|USDT_ADDRESS|amount_bot|X-Payment-Tx`.
4. Silme kapsamını kod, env, deployment config, DB test verisi, UI metinleri,
   dokümantasyon ve scriptler için tek checklist altında takip et.

Çıkış kriteri: Base ortamı boş state ile hazır; repo ve çalışma zamanı konfigürasyonunda
korunması planlanan hiçbir BOT Chain verisi veya fallback'i yok.

### Faz 1 — Zincir çekirdeğini Base Sepolia'ya taşı

1. `lib/botchain.ts` dosyasını sil; yerine `lib/base.ts` oluştur.
2. Elle yazılmış chain nesnesi yerine `viem/chains` içinden `baseSepolia` kullan.
3. İsimleri zincirden bağımsızlaştır:
   - `createBotchainPublicClient` -> `createBasePublicClient`
   - `createBotchainWalletClientWithKey` -> `createBaseWalletClientWithKey`
   - `getBotchainRpcUrl` -> `getBaseRpcUrl`
   - `ensureBotChain` -> `ensureBaseSepolia`
   - `BOTCHAIN_*` -> `BASE_*` veya genel `RPC_*`
4. Varsayılan RPC `https://sepolia.base.org` olabilir ama bu endpoint rate-limited
   olduğundan deployed ortamlarda CDP/Alchemy/QuickNode gibi production RPC zorunlu
   kılınmalı. Public RPC yalnız local fallback olmalı.
5. Explorer helper'larını `https://sepolia-explorer.base.org` veya tek seçilmiş
   canonical explorer'a geçir.
6. Gas format helper'larını BOT yerine ETH olarak yeniden adlandır.
7. Base'in archive-capable RPC davranışına göre log chunk ve concurrency değerlerini
   yeniden ölç. BOT Chain'e özel `pruned history` optimizasyonunu genel RPC fallback'i
   olarak tut veya gereksizse kaldır; 9.999 blok/24 worker değerlerini aynen taşıma.
8. `lib/wagmi-config.ts` içinde yalnız `baseSepolia` tanımla ve bütün connector'ları
   bu ağa geçir.

Çıkış kriteri: Uygulamada chain ID 968, BOT RPC veya BOT explorer referansı yok;
read client `eth_chainId = 0x14a34` doğruluyor.

### Faz 2 — USDT katmanını resmi Base Sepolia USDC'ye çevir

1. `lib/usdt.ts` -> `lib/usdc.ts`:
   - `USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e`
   - `USDC_DECIMALS=6`
   - `usdcToUnits`, `unitsToUsdc`, `formatUsdcAmount`
2. Solidity'de `usdt`, `_usdt` ve hata/event metinlerini `usdc` olarak değiştir.
   Constructor yeni USDC adresini immutable almalı.
3. Token çağrılarında OpenZeppelin `SafeERC20`; para hareketi yapan dış fonksiyonlarda
   `ReentrancyGuard` kullanımı değerlendirilmeli. Bu değişiklik deployment öncesi
   güvenlik testinin parçasıdır.
4. ABI'yi yeniden üret ve `lib/mimir-abi.ts` ile `lib/contract.ts`yi senkronize et.
5. Browser ve ajan write akışlarında USDC allowance kontrolünü koru. Base Account
   destekliyorsa `approve + createClaim/challengeClaim` çağrılarını tek
   `wallet_sendCalls` batch'ine al; standart EOA'larda mevcut iki işlem fallback'i
   kalsın.
6. `amountBot` deprecated alias'ını kaldır; yalnız `amountUsdc` kabul et.
7. Oracle, creator, council, seed, demo, funding ve balance scriptlerini USDC/ETH'e
   geçir. `transferBot` kaldır; bonuslar `transferUsdc` ile ödensin.
8. Minimum stake (`2 * 10**6`) ekonomik olarak 2 USDC kalabilir; ürün kararı olarak
   ayrıca onaylanmalı.

Çıkış kriteri: Yeni kontrat resmi USDC adresiyle deploy edilir; create/challenge,
resolve, refund ve withdraw USDC bakiyeleriyle doğrulanır.

### Faz 3 — Özel 402 sistemini x402 v2 ile değiştir

Mevcut `lib/paid-client.ts` ve `lib/paid-server.ts` yeniden adlandırılarak adapte
edilmemeli; protokol semantiği farklı olduğu için x402 SDK üzerine yeniden kurulmalı.

1. Runtime'ı Node 22'ye yükselt (`package.json`, `.nvmrc`, Railway/Nixpacks/Vercel).
2. Next.js seller tarafı için `@x402/next`, `@x402/core`, `@x402/evm`; ajan buyer
   tarafı için `@x402/fetch`, `@x402/core`, `@x402/evm` ekle. Yalnız v2 paketleri
   kullan; legacy/v2 paket karışımı yapma.
3. Network kimliği `eip155:84532`, scheme varsayılan `exact`, fiyatlar dolar biçiminde
   (`$0.001`, `$0.005`, `$0.01`) tanımlansın. Varsayılan asset resmi USDC olsun.
4. Endpoint haritasını merkezi konfigürasyona al:
   - `GET /api/premium/price`: `$0.001`
   - `POST /api/oracle`: `$0.005`
   - `POST /api/council/preflight`: `$0.001`
   - `GET /api/council/reasoning`: `$0.001`, dinamik persona `payTo`
   - `GET /api/council/vote`: `$0.001`, dinamik juror `payTo`
   - `POST /api/council/subscribe`: başlangıçta `$0.01` exact ödeme
5. Seller middleware `PAYMENT-REQUIRED` üretmeli; buyer `PAYMENT-SIGNATURE` ile retry
   etmeli; başarılı yanıt `PAYMENT-RESPONSE` settlement bilgisini taşımalı.
6. Şunları tamamen sil:
   - native transfer oluşturma
   - `amountWei`/`priceWei`
   - `X-Payment-Tx`, `X-Payment-From`
   - bir saatlik tx freshness kontrolü
   - manuel `getTransaction/getReceipt` doğrulaması
   - app-level tx replay set'i
7. Doğrulama ve settlement facilitator'a bırakılır. Testnet hızlı başlangıçta
   x402.org; staging/production'da env tabanlı CDP facilitator kullan.
8. Agent budget katmanını kaybetme: quote'taki USDC atomic amount bütçe cap'inden
   büyükse imza atmadan çık. `PaymentBudgetExceeded` USDC atomic unit ile çalışsın.
9. `exact` scheme USDC EIP-3009 kullandığı için buyer approval ve gas gerektirmez;
   facilitator settlement gas'ını üstlenir. Bu nedenle x402 için ajanlara ETH
   dağıtımı ödeme amacıyla gerekli değildir, yalnız normal kontrat işlemleri için
   gerekir.
10. Her ücretli endpoint'e açıklama, MIME type, örnek input/output ve Bazaar
    discovery metadata ekle. Böylece ajanlar servisleri keşfedebilir.

Çıkış kriteri: Her endpoint için unpaid 402, signed paid 200, yanlış network,
underpayment, bozuk/expired signature ve duplicate authorization testleri geçer.

### Faz 4 — Revenue ledger'ı token ve network-aware yap

`amount_bot DOUBLE PRECISION` doğrudan `amount_usdc DOUBLE PRECISION` olarak rename
edilmemeli. Muhasebe atomic integer üzerinden yapılmalı.

Önerilen `payments_v2` alanları:

- `id BIGSERIAL`
- `resource TEXT`
- `scheme TEXT` (`exact`, ileride `upto`)
- `network TEXT` (`eip155:84532`)
- `asset_address TEXT`
- `asset_symbol TEXT` (`USDC`)
- `asset_decimals SMALLINT` (`6`)
- `amount_atomic NUMERIC(78,0)`
- `payer TEXT`, `seller TEXT`
- `transaction_hash TEXT`
- `payment_identifier TEXT` (x402 authorization/settlement id)
- `facilitator TEXT`
- `settled_at BIGINT`
- `created_at BIGINT`
- unique constraint: `(network, payment_identifier)` ve uygun olduğunda
  `(network, transaction_hash, resource)`

Revenue API ve UI decimal dönüşümünü en son katmanda yapmalı; toplamlar SQL'de
`SUM(amount_atomic)` ile hesaplanmalı. `totalBot`, `baselineBot`, `amountBot`, `bot`
alanları `totalUsdc`, `baselineUsdc`, `amountUsdc`, `usdc` veya daha genel asset
tiplerine çevrilmeli. Explorer linkleri Base Sepolia transaction URL'sine gitmeli.

Eski BOT revenue satırları yeni şemaya taşınmamalı ve UI'da gösterilmemeli. Revenue
sayacı Base Sepolia x402 USDC ödemeleriyle sıfırdan başlamalı.

Çıkış kriteri: Float yok; ödeme başına idempotent kayıt var; seller ve endpoint
toplamları zincir settlement'larıyla mutabık.

### Faz 5 — Base-native kullanıcı deneyimi

Bu faz core migration'ı bloke etmez, fakat Base'in avantajlarını görünür hale getirir.

1. Wagmi connector listesine Base Account ekle; mevcut injected/WalletConnect
   desteğini koru.
2. Base Account için USDC `approve + create/challenge` işlemini EIP-5792
   `wallet_sendCalls` ile tek onaya indir.
3. CDP Paymaster proxy route'u kur. Yalnız USDC approve ve Mimir'in izin verilen
   fonksiyonlarını sponsorla; kontrat/function allowlist ve per-user bütçe uygula.
4. UI'da capability detection yap; paymaster veya batching yoksa güvenli EOA
   fallback'i kullan.
5. Mevcut 10 dakikalık HMAC council pass'i ilk migration'da korunabilir. Sonraki
   iterasyonda gerçek recurring ürün istenirse Base Subscriptions / Spend
   Permissions ile USDC aboneliğine dönüştür; x402 per-request ve abonelik iki ayrı
   ödeme ürünü olarak modellenmeli.
6. İsteğe bağlı olarak read-only feed'de Flashblocks RPC ile preconfirmation UX'i
   denenebilir; source-of-truth yine standard receipt/final state olmalı.

Çıkış kriteri: Base Account kullanıcısı tek onayla approve+stake yapabilir; sponsor
policy kapsamı dışındaki çağrılar reddedilir; EOA kullanıcıları etkilenmez.

### Faz 6 — Deploy, index ve cutover

1. Kontratı Base Sepolia USDC ve oracle adresiyle deploy et.
2. Source code'u BaseScan/Blockscout üzerinde verify et; deploy block'u kaydet.
3. Oracle/creator/council cüzdanlarına CDP Faucet ile test USDC, normal kontrat
   işlemleri için az miktarda Base Sepolia ETH sağla.
4. Yeni env sözleşmesini staging'e yükle:
   - `NEXT_PUBLIC_BASE_RPC_URL`, `BASE_RPC_URL`
   - `NEXT_PUBLIC_CONTRACT_ADDRESS`, `NEXT_PUBLIC_DEPLOY_BLOCK`
   - `NEXT_PUBLIC_USDC_ADDRESS`
   - `X402_NETWORK=eip155:84532`
   - `X402_FACILITATOR_URL`
   - CDP credentials/paymaster URL yalnız server-side
5. Yeni DB/index'i deploy block'tan başlat; önce read-only sync, sonra writes, sonra
   workers, en son x402 paid routes aç.
6. 24 saatlik soak sırasında RPC hata oranı, event lag, x402 verify/settle hatası,
   ödeme mutabakatı, worker ETH/USDC bakiyesi ve sponsor harcamasını izle.
7. Cutover sonrası BOT env'lerini ve secret'larını hosting platformlarından sil.

Rollback yalnız Base içinde yapılır: yeni release geri alınabilir veya Base kontratı
read-only moda geçirilebilir. BOT Chain frontend'i, RPC'si, kontratı veya verisi hiçbir
rollback yolunun parçası olmayacaktır.

## 5. Dosya bazlı çalışma paketleri

| Paket | Başlıca dosyalar | İş |
|---|---|---|
| Chain | `lib/botchain.ts`, `lib/wagmi-config.ts`, `lib/wallet.tsx` | Base config, RPC, explorer, switch chain |
| Token | `lib/usdt.ts`, `contracts/Mimir.sol`, `lib/mimir-abi.ts` | USDC rename, address, ABI |
| Contract client | `lib/contract.ts`, `lib/agent-wallets.ts` | USDC allowance/write, ETH gas, helper rename |
| x402 | `lib/paid-client.ts`, `lib/paid-server.ts`, ücretli API route'ları | SDK tabanlı x402 v2 seller/buyer |
| Revenue | `lib/db.ts`, `lib/paid-revenue.ts`, `/api/payments/revenue`, `/revenue` | Atomic USDC ledger ve UI |
| Workers | `agents/oracle`, `agents/market-creator`, `agents/council` | Base clients, USDC budgets/bonuslar |
| Ops | `deploy/`, `scripts/`, `.env.example`, Railway/Vercel/Nixpacks | deploy, fund, smoke, env |
| Content | `README.md`, `docs/`, `messages/`, UI components | BOT/USDT/BOTScan temizliği |
| Tests | `tests/node`, yeni contract/x402 integration testleri | davranış, ödeme, indexing, UI |

## 6. Test matrisi

### Kontrat

- USDC approve + create, challenge, rematch.
- Pool/fixed payout, draw/unresolvable refund, cancellation.
- Pending withdrawal ve reentrancy/failed-token senaryoları.
- Oracle-only resolution ve owner işlemleri.
- Decimal/boundary: 1.999999 reddedilir, 2.000000 kabul edilir.

### Zincir ve index

- Chain ID ve yanlış ağ reddi.
- Deploy block'tan event replay; duplicate ve reorg-safe upsert.
- RPC 429/timeout/failover.
- Explorer URL ve receipt state.

### x402

- Her route için 402 challenge ve USDC exact settlement.
- Dinamik persona seller adresi.
- Budget cap ödeme imzasından önce uygulanır.
- Yanlış CAIP-2, asset, payTo, amount ve signature reddi.
- Aynı authorization'ın yeniden kullanımında idempotency/replay davranışı.
- Facilitator timeout/5xx durumunda içerik servis edilmez ve revenue yazılmaz.
- Settlement başarılı fakat DB write başarısızsa reconciliation ile tamamlanır.

### Frontend/Base Account

- Injected, WalletConnect, Coinbase Wallet ve Base Account.
- EOA iki-adım approve/write fallback'i.
- Base Account atomic batch ve paymaster capability fallback'i.
- Revenue ekranında USDC formatı ve Base explorer linkleri.

### Tam sistem

- Faucet -> fund -> deploy -> seed -> challenge -> council x402 vote -> resolve ->
  payout -> revenue reconciliation.
- Oracle, creator ve 10 council persona için balance threshold/alert.

## 7. Tamamlanma kriterleri

Migration ancak şu koşullar birlikte sağlandığında tamamlanmış sayılır:

- Repo taramasında BOT Chain, chain 968, bohr.life, BOT para birimi, USDT isimleri,
  `X-Payment-Tx` ve `amount_bot` kalmamış.
- Tek chain config `baseSepolia`; tek market/payment asset resmi test USDC.
- Sözleşme verify edilmiş ve deploy block kaydedilmiş.
- Tüm market yaşam döngüsü USDC ile test edilmiş.
- Tüm paid endpoint'ler x402 v2 uyum testini geçiyor.
- Revenue ledger atomic USDC tutuyor ve settlement ile mutabık.
- Hosting env'lerinde BOT secret/config kalmamış.
- README, uygulama docs'u, faucet/explorer bağlantıları ve Türkçe/İngilizce metinler
  Base Sepolia/ETH/USDC/x402 modelini doğru anlatıyor.
- Smoke, unit, integration ve en az bir Base Sepolia end-to-end test yeşil.

## 8. Önerilen sıra ve tahmin

Bağımlılık sırası: Faz 0 -> Faz 1 -> Faz 2 -> Faz 3 ve Faz 4 -> Faz 5 -> Faz 6.

Tek deneyimli geliştirici için kaba tahmin:

- Chain + USDC + kontrat: 3-5 gün.
- x402 v2 + revenue şeması: 4-6 gün.
- Base Account/paymaster/batch UX: 3-5 gün.
- Test, dokümantasyon, staging soak ve cutover: 3-5 gün.
- Toplam: yaklaşık 13-21 iş günü.

İlk production-benzeri milestone, Faz 1-4 ve temel E2E tamamlandığında alınabilir;
Base Account/paymaster iyileştirmeleri core migration'dan ayrı feature flag ile
yayınlanmalıdır.

## 9. Karar gerektiren noktalar

Uygulamaya başlamadan önce şu ürün/operasyon kararları kesinleştirilmeli:

1. Testnet'te x402.org ile mi başlanacak, doğrudan CDP facilitator mı kullanılacak?
2. Council bonusları USDC mi olacak? Bu plan evet varsayıyor.
3. Paymaster hangi fonksiyonları ve kullanıcı başına hangi limiti sponsorlayacak?
4. 10 dakikalık pass aynı ürün olarak mı kalacak, gerçek Base Subscription'a mı
   dönüşecek?
5. Minimum stake ve bütün endpoint fiyatları USDC'ye geçince aynı sayısal dolar
   değerlerinde mi kalacak?

## 10. Resmi kaynaklar

- Base network bilgileri: https://docs.base.org/base-chain/quickstart/connecting-to-base
- Base RPC/Flashblocks: https://docs.base.org/base-chain/api-reference/rpc-overview
- Base faucet listesi: https://docs.base.org/base-chain/network-information/network-faucets
- Circle USDC adresleri: https://developers.circle.com/stablecoins/usdc-contract-addresses
- x402 seller quickstart: https://docs.cdp.coinbase.com/x402/seller/quickstart
- x402 buyer quickstart: https://docs.cdp.coinbase.com/x402/quickstart-for-buyers
- x402 network/token desteği: https://docs.cdp.coinbase.com/x402/network-support
- Base Account + Wagmi: https://docs.base.org/base-account/framework-integrations/wagmi/setup
- Batch transactions: https://docs.base.org/base-account/framework-integrations/wagmi/batch-transactions
- Paymaster: https://docs.base.org/base-account/improve-ux/sponsor-gas/paymasters
- Base Subscriptions: https://docs.base.org/base-account/reference/base-pay/subscriptions-overview
