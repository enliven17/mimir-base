# Mimir Base Product Roadmap

> Durum: uygulanabilir ürün ve mühendislik planı  
> Ağ: Base Sepolia (`84532`, `eip155:84532`)  
> Değer birimi: testnet USDC; ETH yalnızca gas  
> Son güncelleme: 2026-08-10

Bu dosya Base migration sonrası Mimir'in bir claim uygulamasından, insanların ve
ajanların market açabildiği, araştırabildiği, pozisyon alabildiği ve gelir
üretebildiği Base-native bir agent market platformuna dönüşüm planıdır.

## 0. Değişmez ürün ve mimari kararlar

- [x] Kontrat state'ini tek finansal doğruluk kaynağı olarak koru; Neon yalnızca
  yeniden üretilebilir read-index, analytics ve off-chain metadata tutsun.
- [ ] Tüm stake, payout, fee, agent bütçesi ve x402 ödemelerini 6 decimal USDC
  atomic integer olarak hesapla; UI dışında `number`/float kullanma.
- [x] Base Sepolia dışındaki eski ağ isimlerini, adreslerini ve koşullu network
  dallarını geri getirme.
- [x] Kullanıcının veya dış ajanın private key'ini Mimir'e yükletme. Dış ajan
  işlemleri kendi wallet'ında imzalasın; Mimir imzayı ve yetki sınırını doğrulasın.
- [x] Otomatik harcamayı yalnızca kullanıcının açıkça imzaladığı token, periyot,
  tutar, market ve bitiş sınırları içinde çalıştır; her izin durdurulabilir ve
  iptal edilebilir olsun.
- [x] Draw, unresolvable ve iptal refund'larından platform veya agent-owner fee
  kesme.
- [x] “Underdog” etiketini kazanma olasılığı iddiası olarak değil, yalnızca payout
  asimetrisi olarak göster.
- [x] **KARAR (2026-08-10): Tek değer birimi Base üzerindeki USDC.** USYC ve
  benzeri tokenize yield/RWA ürünleri kapsam dışıdır — araştırma kapısı da dahil
  tamamen kaldırıldı. USDC'yi Circle ihraç ediyor, fakat Mimir Circle ile ticari
  bir entegrasyon veya ortaklık kurmaz: yalnızca standart ERC-20 USDC kontratını
  okur. Idle bakiye USDC olarak durur; hiçbir yüzeyde yield vaat edilmez.

## 1. Önce veri modelini düzelt: üç ayrı eksen

Bugünkü `marketType` alanı konu/sonuç formatını, `oddsMode` ekonomik modeli
anlatıyor. Yeni oyun modlarını bu alanlara rastgele string ekleyerek modelleme.

### 1.1 Canonical sınıflandırma

- [x] `subjectType` tanımla: `binary`, `moneyline`, `spread`, `total`, `prop`,
  `custom`.
- [x] `settlementMode` tanımla: `pool`, `duel`, `fixed_odds`; kontrat v2 sonrası
  `squad_pool`.
- [x] `productModifiers[]` tanımla: `underdog_boost`, `streak`,
  `rematch_ladder`, `conviction`.
- [x] Geçiş süresinde mevcut onchain `marketType` ve `oddsMode` alanlarını codec
  katmanında canonical modele map et.
- [x] Bilinmeyen enum değerlerini sessizce `pool` yapma; read-index'te
  `unsupported` olarak işaretle ve telemetry üret.
- [x] Market kuralları için version ekle: `rulesVersion`, `contractVersion`,
  `contextSchemaVersion`.

### 1.2 Market mode registry

- [x] Tek bir `lib/market-modes.ts` registry oluştur; create UI, detail UI,
  market-creator ve testler aynı policy kaynağını kullansın.
- [x] Her mode için `maxChallengers`, stake eşleme kuralı, odds policy, CTA metni,
  görünürlük, rematch desteği ve kontrat gereksinimini tanımla.
- [x] Registry'nin yanlış kombinasyonları reddetmesini test et; örneğin
  `duel + maxChallengers > 1`, yetersiz teminatlı fixed odds veya parent olmadan
  `rematch_ladder`.

**Kabul kriteri:** Aynı market create formunda, read-index'te ve VS detayında
aynı canonical mode olarak görünür; legacy marketler bozulmadan okunur.

---

## 01. Product analytics with PostHog — P0

Amaç: Sonraki tüm ürün kararlarını ölçebilecek tam funnel ve güvenilir event
şeması kurmak. Analiz kullanıcı fonlarını veya hassas reasoning içeriğini sızdırmamalı.

### İşler

- [x] PostHog client/server entegrasyonunu environment flag ile ekle.
- [x] Wallet adresini raw PII olarak göndermek yerine kararlı, salt'lı actor ID
  üret; agent ve human actor tipini ayrı property olarak taşı.
- [x] Consent, opt-out, DNT ve production/test ayrımını uygula.
- [x] Ortak event envelope tanımla: `event_version`, `chain_id`, `contract`,
  `claim_id`, `subject_type`, `settlement_mode`, `modifiers`, `actor_type`,
  `agent_id`, `source_surface`, `locale`, `tx_status`.
- [x] Şu funnel event'lerini instrument et:
  - [x] `market_viewed`
  - [x] `create_started`, `create_mode_selected`, `create_submitted`, `create_confirmed`
  - [x] `stake_previewed`, `stake_started`, `stake_confirmed`, `stake_failed`
  - [x] `payout_preview_seen`, `low_upside_warning_seen`
  - [x] `agent_viewed`, `agent_followed`, `agent_unfollowed`
  - [x] `reasoning_opened`, `reasoning_x402_purchased`
  - [x] `share_card_generated`, `share_card_clicked`
  - [x] `rematch_started`, `rematch_confirmed`
  - [x] `copy_permission_created`, `copy_executed`, `copy_skipped`, `copy_revoked`
- [x] Server event'leri için idempotency key kullan; retry çift sayım yapmasın.
- [x] PostHog'da create, stake, settlement-return, follow-to-copy ve share-to-market
  funnel'larını oluştur.
- [x] Mode/category/cohort bazlı retention ve conversion dashboard'ları oluştur.
- [x] Test wallet'larını internal cohort ile ayır.

### KPI ve kabul kriteri

- [ ] Create → confirmed ve view → stake conversion güvenilir ölçülüyor.
- [ ] Eventlerin %99'unda `event_version`, chain ve mode alanları dolu.
- [x] Event payload'larında private key, signature, invite key, raw prompt veya
  kullanıcıya özel evidence bulunmadığı otomatik testle doğrulanıyor.

Bağımlılık: yok. Diğer milestone'lar bundan sonra feature flag ve event planıyla çıkar.

---

## 02. Social share cards — P1

- [x] Her market için dinamik OG/share card üret: claim, iki taraf, toplam pot,
  mode, deadline ve kaynak alan adı.
- [x] Settlement kartı üret: verdict, kazanan taraf, payout ve seri skoru.
- [x] Duel kartında iki actor/agent kimliğini ve “winner takes pot” dilini kullan.
- [x] Rematch kartında round ve Best-of-N skorunu göster.
- [x] Kart URL'sine yalnızca public market ID koy; private invite key'i görsele,
  analytics'e veya cache key'e yazma.
- [x] X, Farcaster ve standart Open Graph boyutlarında render testi ekle.
- [x] Lokalizasyon, uzun claim kırpma, emoji ve missing avatar fallback'lerini test et.
- [x] Share click → market view attribution'ını PostHog'a bağla.

**Kabul kriteri:** Her public aktif/settled market deterministik bir kart üretir;
private market kartı yetkisiz kişiye claim detayını sızdırmaz.

---

## 03. Public agent reasoning feed — P1

Mevcut council reasoning akışını okunabilir ve kaynak izli bir market timeline'ına
dönüştür.

- [x] Append-only `agent_reasoning_events` tablosu tasarla:
  `event_id`, `claim_id`, `agent_id`, `stage`, `position`, `confidence_bps`,
  `summary`, `evidence_refs`, `model/provider`, `prompt_version`, `created_at`,
  `visibility`, `payment_identifier`.
- [x] Raw hidden chain-of-thought yayınlama; kullanıcıya kısa gerekçe, iddia,
  evidence ve belirsizlik yayınla.
- [x] Council preflight, pre-stake görüşü, peer response, vote ve settlement
  reflection event tiplerini ayır.
- [x] Her evidence referansında URL/domain, capture time, content hash ve freshness
  göster.
- [x] Aynı reasoning'in retry ile iki kez yazılmasını engelle.
- [x] `/vs/[id]` üzerinde kronolojik feed, agent/category filtresi ve “before/after
  stake” ayrımı ekle.
- [x] Public özet ile x402 premium ayrıntısını ayır; ödeme sonrası erişimi mevcut
  `payments_v2` idempotency modeliyle ilişkilendir.
- [x] Prompt injection, kişisel veri, güvenli olmayan URL ve telifli uzun alıntı
  redaction katmanı ekle.
- [x] Reasoning silinirse audit kaydını tombstone olarak koru.

**Kabul kriteri:** Kullanıcı her ajan kararında pozisyonu, zamanı, kullanılan
kaynakları ve belirsizliği görebilir; gizli model reasoning'i veya credentials
göremez.

---

## 04. Philosopher council track — P1

- [x] Persona registry'ye şu ilk-prensip arketiplerini ekle: Stoic, Skeptic,
  Utilitarian, Deontologist, Pragmatist ve Bayesian Epistemologist.
- [x] Her persona için ayrı public wallet/agent identity, açıklanabilir decision
  rubric, risk limiti ve kategori kapsamı tanımla.
- [x] “Felsefi stil” ile rastgele karşıtlık üretmeyi ayır; aynı evidence üzerinde
  farklı normatif/epistemik çerçeveler kullan.
- [x] Persona prompt versiyonlarını ve evaluation fixture'larını version-control et.
- [x] Mevcut council ile philosopher track'i ayrı filtrele; kombine consensus'u
  ayrıca hesapla.
- [x] Her persona için minimum calibration seti, bias testi ve tutarlılık testi ekle.
- [x] Wallet funding ve x402 bütçelerini persona bazında sınırla.
- [x] Sabit `COUNCIL_PERSONAS` dizisini ileride BYOA registry okuyabilecek adapter
  arkasına al.

**Kabul kriteri:** Her philosopher aynı markette kendine özgü, kaynaklı ve
tekrarlanabilir bir rubric ile oy verir; kimliği ve wallet'ı UI'da doğrulanabilir.

---

## 05. Fee system — P0, kontrat değişikliği

### 5.1 Ekonomik kararlar

- [x] İki ayrı fee hattını tanımla:
  - [x] `platformFeeBps`: yalnızca resolved markette dağıtılabilir kazanç/pot
    üzerinden protokol geliri.
  - [x] `agentOwnerFeeBps`: yalnızca agent-attributed create/copy/service
    aktivitelerinde ilgili agent sahibine gelir.
- [x] Deposit anında fee alma; başarısız, draw, unresolvable ve refund akışlarını
  kesintisiz iade et.
- [x] Agent fee'nin stake principal, brüt payout veya net profit tabanlarından
  hangisine uygulanacağını ADR ile sabitle. Öneri: copy için net realized profit;
  x402 için settled service revenue.
- [x] Fee stacking üst sınırı ve rounding/dust policy belirle.
- [x] Creator, agent owner ve platform aynı adres olduğunda double-counting'i
  engelle.

### 5.2 Kontrat ve muhasebe

- [x] Yeni kontrat sürümünde immutable/capped fee policy veya timelock'lı yönetim
  tasarla; admin'in anlık sınırsız fee değiştirmesine izin verme.
- [x] Claim'e create anındaki fee snapshot'ını yaz; sonradan fee değişimi açık
  marketleri etkilemesin.
- [x] Agent attribution için güvenilir `agentId → ownerFeeRecipient` snapshot'ı al.
- [x] Push payout yerine gerektiğinde pull-based `claimFees/claimPayout` modelini
  değerlendir; reentrancy ve başarısız recipient riskini azalt.
- [x] Eventler: `FeePolicyUpdated`, `FeeAccrued`, `FeeClaimed`, `AgentAttributed`.
- [x] `payments_v2` x402 revenue ile market fee ledger'ını aynı toplamda birleştir,
  fakat kaynak türlerini ayrı tut.
- [x] `/revenue` sayfasında gross volume, payouts, platform fees, agent-owner fees,
  x402 revenue ve unclaimed balance göster.

### 5.3 Testler

- [x] Pool, Duel, Fixed Odds, creator-win, challenger-win, draw, cancel ve dust
  için invariant/property testleri.
- [x] `sum(principal + payout + fees + dust) == escrow inflow` invariant'ı.
- [x] Fee-on-transfer/rebasing token desteklenmediğini açıkça doğrula; yalnızca
  configured USDC kabul et.
- [x] Slither/fuzz/reentrancy ve malicious fee-recipient testleri.

**Kabul kriteri:** Her atomic USDC bir kez ve açıklanabilir şekilde principal,
payout, platform fee, owner fee veya dust olarak muhasebeleşir.

---

## 06. Game modes — P0/P1

### 6.1 Pool Market — canlı primitive, P0 anlaşılabilirlik

- [x] Explorer kartında creator pool, challenger pool, total pot ve side imbalance
  göster.
- [x] Stake öncesi `total return`, `returned principal`, `net profit` alanlarını
  ayrı göster.
- [x] Challenger payout preview formülünü kontratla aynı atomic integer helper'da
  tut: `stake + stake / challengerPoolAfterJoin * creatorStake`.
- [x] Kalabalık tarafa katılımda düşük-upside uyarısı göster.
- [x] Doküman ve VS sayfasına “Kârın Mimir'den değil kaybeden taraftan gelir”
  açıklamasını ekle.
- [x] 10 USDC creator / 10 × 10 USDC challenger örneğini golden test yap: NO
  kazanırsa challenger başına 11 USDC; YES kazanırsa creator 110 USDC.

### 6.2 Duel / 1v1 Fixed Challenge — P0 ilk yeni mode

- [x] Create ekranına `Duel` ve `Pool Market` selector ekle.
- [x] Duel policy: `maxChallengers = 1`, challenger stake = creator stake,
  winner takes two-person pot, draw/unresolvable = full refund.
- [x] Eşit stake'i yalnızca UI'da değil kontratta veya mode-aware write guard'da
  enforce et; UI policy'sine güvenme.
- [x] CTA metnini `Accept Duel`; rolleri `Creator` ve `Rival` yap.
- [x] Public open duel ile belirli wallet/agent'a private duel'i ayır.
- [x] XMTP konuşmasından duel oluşturma/accept deep-link akışı ekle.
- [x] Settlement sonrası `Run it back`, Best of 3 ve Best of 5 girişlerini ekle.

**Kabul kriteri:** İkinci challenger katılamaz, eşit olmayan stake gönderilemez ve
kazanan fee sonrası hesaplanan iki kişilik payout'u alır.

### 6.3 Creator-Backed Fixed Odds — P0 UI hardening

- [x] Create ekranında `1.25x`, `1.5x`, `2x`, `3x` total return preset'leri ekle.
- [x] “2x profit” yerine daima “2x total return” yaz.
- [x] `availableCreatorLiquidity = creatorStake - reservedCreatorLiability`
  değerini göster.
- [x] Stake girilirken liability'yi kontratla aynı rounding ile önizle ve fazla
  stake'i submit öncesi engelle.
- [x] Birden çok challenger sonrası kalan kapasiteyi canlı güncelle.
- [x] RPC ile UI state yarışırsa simulation/revert mesajını anlaşılır göster.
- [x] Concurrent challenge ve liability exhaustion testi ekle.

### 6.4 Underdog Boost — P1 discovery modifier

- [x] Explorer'a `Underdog` badge, upside multiple sort ve filter ekle.
- [x] “Minority side” ve “crowded side” etiketlerini havuz büyüklüğünden türet.
- [x] Stake preview'da payout asimetrisini açıkla; kazanma ihtimali yorumu yapma.
- [x] Agent commentary'nin “underpriced” iddiası için evidence ve confidence zorunlu
  olsun.
- [x] Fee discount düşünülürse önce fee kontratı ve abuse/sybil analizi tamamla.

### 6.5 Rematch Ladder — P1 mevcut `parentId` üzerine

- [x] Settled VS sayfasında tüm parent/child zincirini görünür yap.
- [x] Read-index'te cycle guard ile rivalry root, round number ve seri skorunu
  hesapla.
- [x] `Run it back`, Best of 3, Best of 5 akışlarında question/source/rule
  metadata'sını devral; stake ve deadline'ı yeniden seçtir.
- [x] Zayıf settlement rule'u otomatik kopyalamadan önce kullanıcıya düzeltme
  adımı göster.
- [x] Aynı parent'tan paralel rematch oluşması için branch/series policy belirle.

### 6.6 Streak Mode — P1 off-chain scoring modifier

- [x] `current_streak`, `best_streak`, `resolved_count`, `win_rate` projection'ı
  oluştur.
- [x] Draw/refund için streak'i değiştirme; cancel/unresolvable sonucu sayma.
- [x] Reorg/resync sonrası streak'in deterministik yeniden üretildiğini test et.
- [x] Dashboard, agents feed ve profile üzerinde streak badge ekle.
- [x] “Streak at risk” dilini riskli davranışı teşvik etmeyecek şekilde test et.
- [x] Kategori bazlı ve agent/human ayrı leaderboard ekle.

### 6.7 Conviction Mode — P1 scoring modifier

- [x] v1 formülünü ADR'de açıkla ve version'la:
  `correctness × cappedStakeFactor × timeFactor × underdogFactor`.
- [x] Evidence quality/confidence gibi öznel girdileri ilk sürümde ayrı göster;
  doğrulanana kadar parasal skorla birleştirme.
- [x] Stake factor için log/cap kullan; zengin wallet'ın otomatik lider olmasını
  engelle.
- [x] Early backer marker, realized PnL, win rate ve conviction leaderboard ekle.
- [x] Sybil, late-entry, micro-stake spam ve self-created-market gaming testleri.

### 6.8 Squad vs Squad — P2, kontrat v2

- [x] V0 görsel prototip: creator'ı Side A captain, challengers'ı Side B olarak
  sun; bunun gerçek two-sided deposit olmadığını açıkça belirt.
- [x] V1 kontrat tasarımı: her iki tarafa çoklu deposit, side shares, proportional
  payout, withdrawal/cancel, deadline ve dust accounting.
- [x] Creator'a ayrı ekonomik ayrıcalık vermek gerekiyorsa açıkça modelle; gizli
  bir avantaj bırakma.
- [x] `Back YES / Back NO`, iki taraf participant count/pool ve stacked avatar UI.
- [x] İki taraf için fee, late liquidity ve payout invariant fuzz testleri.

### Game-mode rollout gate

- [x] Pool legibility tamamlanmadan yeni mode'u default yapma.
- [x] Sıra: Pool UI → Duel → Fixed Odds hardening → Underdog → Rematch →
  Streak/Conviction → gerçek Squad vs Squad.

---

## 07. Bring Your Own Agent (BYOA) — P0 platform dönüşümü

### 7.1 Agent identity ve registry

- [x] `agents` registry tasarla: `agent_id`, owner wallet, operator wallet,
  payout wallet, metadata URI/hash, capabilities, categories, supported modes,
  status, reputation, created/revoked timestamps.
- [x] Owner ve operator'ı ayır; owner fee alır ve operator key'i revoke/rotate eder.
- [x] Wallet signature challenge + nonce + expiry ile registration/auth uygula.
- [x] Agent metadata schema: name, description, avatar, reasoning policy, source
  policy, model disclosure, contact, terms URL.
- [x] `market_creator`, `council_juror`, `researcher`, `copy_source`, `x402_seller`
  capability'lerini ayrı ayrı grant/revoke et.
- [x] Basenames opsiyonel profil katmanı olsun; kimlik doğruluğu wallet signature'a
  dayansın.

### 7.2 Kademeli yetki modeli

- [x] Seviye 0: read-only market/context erişimi.
- [x] Seviye 1: market proposal; Mimir moderation/preflight sonrası yayınlar.
- [x] Seviye 2: kendi wallet'ıyla limitli market create.
- [x] Seviye 3: council vote/stake.
- [x] Seviye 4: takip edilebilir copy-source ve x402 seller.
- [x] Her seviyede rate limit, maksimum aktif market, günlük USDC exposure,
  kategori/mode allowlist ve emergency pause uygula.
- [x] Reputation tek başına finansal yetki vermesin; explicit owner permission
  her zaman zorunlu kalsın.

### 7.3 Wallet seçenekleri

- [x] Human-owned agent için Base Account Sub Account + Spend Permission spike yap.
- [x] Server/standalone agent için CDP Agentic Wallet/AgentKit adapter'ını EOA ve
  EIP-1271 uyumlu genel wallet interface arkasına al; vendor lock-in oluşturma.
- [x] Agent wallet'ı için per-call, per-session/day ve total exposure limitleri ekle.
- [x] Gas sponsorship/paymaster yalnızca allowlist contract calls için kullanılsın.
- [x] Mimir-managed legacy private-key persona'larını aynı registry interface'ine
  adapte et; web process'e key taşıma.

### 7.4 Agent API/SDK

- [x] `register`, `heartbeat`, `proposeMarket`, `createMarket`, `publishReasoning`,
  `vote`, `stake`, `listPositions`, `listEarnings`, `revoke` endpointlerini version'la.
- [x] OpenAPI/JSON Schema ve TypeScript SDK yayınla.
- [x] Idempotency key, signed timestamp, nonce replay guard ve request audit log ekle.
- [x] Dry-run/simulation endpoint'i ekle; ajan işlem göndermeden payout, fee,
  allowance ve policy sonucunu görebilsin.
- [x] Sandbox Base Sepolia onboarding örneği ve conformance test suite yayınla.

**Kabul kriteri:** Dış geliştirici private key paylaşmadan ajanını kaydeder, proposal
gönderir, açıkça verilen limit içinde market açar ve owner-fee attribution'ı
doğrulanır; revoke sonrası yeni işlem yapamaz.

---

## 08. Copy trading, both directions — P1/P2

Bağımlılıklar: analytics, agent registry, fee system, güvenilir position events ve
harcama izinleri tamamlanmadan production'a çıkmaz.

### 8.1 Human → agent copy MVP

- [x] Follow ile finansal copy permission'ı ayır; follow hiçbir zaman para harcatmaz.
- [x] Kullanıcı policy'si: agent, max per position, daily/weekly cap, total open
  exposure, category/mode allowlist, min confidence, odds/payout floor, expiry.
- [x] Permission oluştururken worst-case USDC harcamayı açıkça göster ve imzalat.
- [x] Execution öncesi kontrat simulation, deadline, remaining slots, liquidity,
  payout floor ve duplicate position guard uygula.
- [x] `executed`, `skipped`, `failed`, `expired` nedenlerini kullanıcıya göster.
- [x] Global pause ve tek permission revoke işlemini anında destekle.

### 8.2 Agent → agent copy

- [x] İlk sürümde max copy depth = 1 uygula.
- [x] A→B→A cycle detection ve self-copy guard ekle.
- [x] Orijinal signal agent ile execution agent attribution'ını ayrı tut.
- [x] Owner fee ağacında aynı hacmi tekrar tekrar ücretlendirme; fee snapshot ve
  tek source-of-truth attribution ID kullan.
- [x] Agent bütçe limiti bitince yeni izin istemeden işlemi skip et.

### 8.3 Güvenlik ve kullanıcı kontrolü

- [x] Base Spend Permission kullanılıyorsa token=USDC, period, allowance ve spender
  sınırlarını onchain doğrula; yalnız UI database'ine güvenme.
- [x] Upgradeable spender/target allowlist riskini açıkça incele.
- [x] Copy executor'ın key compromise, replay, frontrun ve stale odds senaryolarını
  threat-model et.
- [x] Her copy işlemi için source position, permission ID, simulation snapshot,
  tx hash, fee ve skip reason audit kaydı tut.

**Kabul kriteri:** Kullanıcı imzaladığı maksimumdan fazla kaybedemez; izin iptalinden
sonra execution yapılamaz; copy loop veya fee loop oluşamaz.

---

## 09. Agent baskets — P2, en son

- [x] Idle sermaye USDC olarak durur; yield/RWA katmanı yok (bkz. §0 kararı).
- [x] Önce salt okunur “virtual basket” prototipi kur: seçili agent ağırlıkları,
  backtest, drawdown, category/mode exposure ve simulated NAV.
- [x] Gerçek para MVP'si için non-custodial vault mimarisini değerlendir; ERC-4626
  uygunluğunu, USDC decimal/donation/inflation risklerini ADR ile incele.
- [x] Deposit/redemption, weight rebalance, max single-agent/category exposure,
  paused agent, stale signal ve failed copy kurallarını tanımla.
- [x] Management/performance fee varsa high-water mark, realized PnL ve fee
  recipient accounting'i açıkça modelle.
- [x] NAV ve share price için atomic rounding/dust invariant'ları ekle.
- [x] Emergency withdrawal'ın agent executor ve oracle'dan bağımsız çalışmasını sağla.
- [ ] Audit, legal/custody, sanctions/eligibility ve mainnet launch review tamamlanmadan
  gerçek fon kabul etme.

**Kabul kriteri:** Basket fonları ve getirileri her an yeniden hesaplanabilir;
kullanıcı riskleri görür ve exit yolu tek bir ajanın çalışmasına bağlı değildir.

---

## 10. Market Context Engine v2 + Agent Reach — P0

Bugünkü market-creator az sayıda kaynak adapter'ı ve ağırlıklı olarak
`binary + pool` üretimi kullanıyor. Amaç daha geniş konu kapsamı sağlarken
ajanlara sınırsız browser/shell vermek değil, güvenli ve kaynak izli araştırma
altyapısı sunmaktır.

### 10.1 Research Gateway

- [x] Server-side, read-only `Research Gateway` oluştur; ajanlar doğrudan internet
  veya internal network'e çıkmasın.
- [x] Adapter'lar: official web/API, RSS, GitHub public metadata, sports, weather,
  market data, release calendars ve gerektiğinde x402/Bazaar kaynakları.
- [x] Domain allow/deny list, DNS/IP SSRF koruması, redirect limiti, response-size
  limiti, MIME kontrolü ve timeout ekle.
- [x] Private browser session, cookie, localhost, cloud metadata, file URL ve write
  action'larını yasakla.
- [x] Per-agent request, token, x402 USDC ve günlük bütçe uygula.
- [x] Sonuçları cache et; aynı kaynak için gereksiz ücret/istek tekrarını engelle.
- [x] Tool manifest'inde capability, fiyat, freshness ve trust tier yayınla.
- [x] x402 Bazaar discovery sonuçlarını fiyat/capability allowlist'inden geçir;
  keşfedilen endpoint'i otomatik güvenilir sayma.

### 10.2 Context pack schema

- [x] Her aday market için `MarketContextPack` üret:
  - [x] canonical claim ve taraflar
  - [x] category/topic ve entity'ler
  - [x] primary resolution source
  - [x] corroborating sources[]
  - [x] capturedAt, publish time, source timezone
  - [x] excerpt/structured fact ve content hash
  - [x] freshness, trust tier, corroboration/conflict flags
  - [x] deadline, resolution window, edge cases ve void rule
  - [x] geographic scope, units, threshold ve exact rounding rule
  - [x] agent confidence ve unresolved questions
- [x] Onchain'e uzun context yazma; immutable hash/URI ve settlement rule özeti yaz.
- [x] Primary resolution source değişirse version ve audit event üret.
- [x] Source kaybolursa snapshot/hash ve fallback source policy uygula.

### 10.3 Konu kapsamını genişlet

- [x] İlk güvenilir adapter dalgası: crypto, sports, weather/climate, stocks,
  macro/economic releases, technology/product releases, AI/open-source, gaming/esports,
  entertainment/film/music, awards, science/space ve culture.
- [x] Her kategori için minimum source count, primary source allowlist, freshness,
  deadline ve settlement template tanımla.
- [x] Elections/public policy gibi regülasyon ve manipülasyon riski yüksek alanları
  ayrı compliance feature flag arkasında tut.
- [x] Sağlık, ölüm/şiddet, kişisel zarar, illegal activity ve doğrulanamaz özel kişi
  claim'leri için mevcut moderation block policy'yi koru/genişlet.
- [x] Kategori coverage, reject reason, source failure ve settlement ambiguity
  metriklerini PostHog/operational telemetry ile izle.

### 10.4 Otomatik market-creator mode matrix

- [x] Market-creator output schema'sına canonical `subjectType`, `settlementMode`,
  `productModifiers`, `contextPack`, `stakePolicy` ve `modeRationale` ekle.
- [x] Pool: public, çok katılımcılı konular için varsayılan otomatik mode.
- [x] Duel: yalnız belirli target agent/user varsa private duel üret; targetsızsa
  `open_duel_invite` proposal olarak bırak.
- [x] Fixed Odds: creator wallet'ın available liquidity ve total liability cap'ini
  kontrol etmeden market açma.
- [x] Underdog: create-time settlement mode değil; havuz oluşunca dinamik modifier.
- [x] Rematch: yalnız settled parent ve yeterli rivalry context varsa üret.
- [x] Streak/Conviction: finansal settlement mode değil; eligible marketlerde
  read-index modifier/scoring olarak uygula.
- [x] Squad vs Squad: kontrat v2 deploy edilene kadar gerçek mode olarak üretme.
- [x] Her run için mode/category çeşitlilik kotası koy; kaliteyi düşüren rastgele
  çeşitlilik üretme.
- [x] Active market cap'i kategori, mode, creator ve aynı event/entity bazında uygula.
- [x] Duplicate kontrolünü yalnız question string ile değil entity + event + threshold
  + deadline signature ile yap.
- [x] Preflight council'e “resolution clarity”, “source independence”, “liquidity
  fit” ve “best mode” skoru ekle.
- [x] Önce proposal-only shadow mode çalıştır; insan review sonuçlarıyla precision
  ölçmeden autonomous publish'i açma.

**Kabul kriteri:** Otomatik oluşturulan marketlerin context pack'i kaynaklı,
çözülebilir ve mode'a uygun olur; ajan hiçbir zaman bütçe/allowlist dışı kaynağa
erişemez veya mode'un teminat gereksinimini aşamaz.

---

## 11. Önerilen veri modeli ve API backlog'u

### Yeni tablolar/projection'lar

- [x] `agent_registry`, `agent_operators`, `agent_capabilities`
- [x] `agent_reasoning_events`, `evidence_sources`, `market_context_packs`
- [x] `agent_follows`, `copy_permissions`, `copy_executions`
- [x] `fee_policies`, `fee_accruals`, `agent_revenue_attribution`
- [x] `market_series`, `profile_stats`, `conviction_scores`
- [x] `basket_definitions`, `basket_positions`, `basket_nav_snapshots`
- [x] Tüm tablolarda migration version, timestamps, stable IDs ve gerekli unique
  idempotency constraint'leri.
- [x] Finansal tabloları PostHog'a kaynak yapma; analytics eventlerini finansal
  ledger yerine kullanma.

### API kuralları

- [x] Public read, authenticated user, registered agent ve internal worker route'larını
  ayrı policy katmanlarına böl.
- [x] Zod/JSON Schema ile request/response versioning uygula.
- [x] Para veya yetki değiştiren her endpoint'te signature/nonce/idempotency/audit.
- [x] Rate limit'i IP yanında wallet, agent ID, route ve ekonomik bütçe bazında uygula.
- [x] API error'larına machine-readable code ve safe retry hint ekle.

---

## 12. Test, güvenlik ve operasyon checklist'i

### Kontrat

- [x] Unit, invariant ve stateful fuzz: escrow conservation, liability cap, payout,
  fee, refund, duplicate claim ve max participants.
- [x] Mode başına malicious ERC-1271 signer, reverting receiver, reentrancy ve
  concurrent transaction senaryoları.
- [ ] Deploy sonrası ABI/bytecode/address doğrulama ve Base Sepolia smoke test.
- [x] Yeni kontrat gerekiyorsa clean-state testnet redeploy planı; eski ağ için
  data/branch compatibility katmanı ekleme.

### Agent güvenliği

- [x] Prompt injection ve poisoned evidence fixture'ları.
- [x] Tool allowlist bypass, SSRF, redirect, DNS rebinding ve oversized content testleri.
- [x] Per-agent wallet/research/x402 bütçe kill-switch.
- [x] Agent key rotation, owner revoke ve compromised operator runbook'u.
- [x] Market create ve copy executor'ı için dry-run + simulation zorunluluğu.

### Operasyon

- [x] Worker heartbeat, queue lag, RPC failure, facilitator failure, source failure,
  oracle backlog ve settlement latency alarmı.
- [x] Postgres/read-index tamamen silinse onchain eventlerden yeniden kurulabildiğini
  düzenli test et.
- [x] Feature flag'ler: mode, category, BYOA capability, copy execution, fee policy,
  basket deposits.
- [x] Incident sırasında create/stake/copy/x402'yi birbirinden bağımsız pause et.

---

## 13. Uygulama dalgaları ve bağımlılık kapıları

### Wave A — Ölçüm ve güven (1–2 sprint)

- [x] 01 PostHog event schema ve funnel.
- [x] Pool payout/imbalance UI.
- [x] Canonical mode registry.
- [x] Reasoning event schema ve public-safe summary policy.

### Wave B — Dağıtım ve ilk yeni oyun (1–2 sprint)

- [x] 02 Share cards.
- [x] 03 Reasoning feed v1.
- [x] Duel mode.
- [x] Fixed Odds liquidity/liability UI.

### Wave C — Market Context Engine (2–3 sprint)

- [x] Research Gateway ve `MarketContextPack`.
- [x] Yeni kategori adapter'ları.
- [x] Market-creator multi-mode proposal-only shadow run.
- [x] Underdog discovery ve Rematch Ladder.

### Wave D — Agent platform (2–4 sprint)

- [x] 04 Philosopher track.
- [x] 07 Agent registry ve BYOA proposal-only.
- [x] Base Sub Account/Spend Permission ve CDP Agentic Wallet spike.
- [x] BYOA limitli create/vote rollout.

### Wave E — Ekonomi ve otomasyon (3–5 sprint + audit)

- [x] 05 Fee contract, ledger ve revenue UI.
- [x] 08 Human → agent copy MVP.
- [x] Agent → agent copy; depth=1 ve cycle guard.
- [x] Streak/Conviction scoring.

### Wave F — Yeni protokol yüzeyi (audit sonrası)

- [x] Gerçek Squad vs Squad kontratı.
- [x] Agent baskets virtual prototype.
- [ ] Non-custodial basket vault ve yasal/security review.

## 14. Launch gates

- [ ] **Duel GA:** eşit stake enforcement + payout invariant + analytics hazır.
- [ ] **Automated market GA:** shadow precision hedefi, source failure oranı ve
  ambiguity review eşiği ürün ekibi tarafından yazılı onaylı.
- [ ] **BYOA funded actions:** registry/revoke, budget, simulation ve audit log hazır.
- [ ] **Fees:** kontrat audit/fuzz, fee disclosure ve reconciliation hazır.
- [ ] **Copy trading:** signed permission, onchain cap, pause/revoke ve loss-limit
  testleri hazır.
- [ ] **Squad/Baskets:** ayrı kontrat audit'i ve ekonomik invariant raporu hazır.
- [ ] **Mainnet:** testnet KPI hedefleri, incident runbook, legal/compliance review,
  RPC/facilitator redundancy ve monitoring tamam.

## 15. Başarı metrikleri

- [x] Market view → stake conversion, mode bazında.
- [x] Create start → confirmed market conversion.
- [x] D1/D7/D30 creator, challenger ve agent-owner retention.
- [x] Settlement sonrası rematch oranı ve series completion.
- [x] Reasoning open/purchase → stake conversion.
- [x] Share card → qualified market view → stake attribution.
- [x] Otomatik market proposal acceptance, ambiguity/reject ve source failure oranı.
- [x] BYOA registered → active → revenue-earning agent funnel.
- [x] Copy execution success/skip/failure, realized PnL ve permission revoke oranı.
- [x] Platform revenue, agent-owner revenue ve x402 revenue; gross volume'dan ayrı.
- [x] Oracle resolution latency, worker health ve read-index freshness.

## 16. Teknik araştırma referansları

- Base Account Sub Accounts ve Spend Permissions:
  <https://docs.base.org/base-account/improve-ux/sub-accounts>
- CDP Spend Permissions:
  <https://docs.cdp.coinbase.com/wallets/using-wallets/spend-permissions>
- CDP Agentic Wallet:
  <https://docs.cdp.coinbase.com/agentic-wallet/cli/welcome>
- AgentKit wallet management:
  <https://docs.cdp.coinbase.com/agent-kit/core-concepts/wallet-management>
- x402 seller/Bazaar discovery:
  <https://docs.x402.org/getting-started/quickstart-for-sellers>
- x402 buyer discovery ve payment schemes:
  <https://docs.x402.org/getting-started/quickstart-for-buyers>
- Circle USDC contract addresses (yalnızca adres doğrulaması için):
  <https://developers.circle.com/stablecoins/usdc-contract-addresses>
