# Graph Report - C:\Users\enliven\Documents\GitHub\mimir-base  (2026-08-10)

## Corpus Check
- 238 files · ~214,737 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1594 nodes · 3986 edges · 80 communities (65 shown, 15 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.55)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78

## God Nodes (most connected - your core abstractions)
1. `createBotchainPublicClient()` - 51 edges
2. `getExplorerTxUrl()` - 42 edges
3. `weiToBot()` - 41 edges
4. `unitsToUsdt()` - 37 edges
5. `getContractAddress()` - 33 edges
6. `VSData` - 29 edges
7. `usdtToUnits()` - 29 edges
8. `VSDetailPage()` - 26 edges
9. `callLLM()` - 24 edges
10. `shortenAddress()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `EvidenceInspectorProps` --references--> `VSData`  [EXTRACTED]
  components/EvidenceInspector.tsx → lib/contract.ts
- `fetchClaim()` --calls--> `fetchDecodedClaim()`  [EXTRACTED]
  agents/council/index.ts → lib/claim-codec.ts
- `poll()` --calls--> `weiToBot()`  [EXTRACTED]
  agents/council/index.ts → lib/botchain.ts
- `main()` --calls--> `weiToBot()`  [EXTRACTED]
  agents/council/index.ts → lib/botchain.ts
- `PersonaVote` --references--> `PersonaSpec`  [EXTRACTED]
  app/api/vs/[id]/council/route.ts → agents/council/personas.ts

## Import Cycles
- None detected.

## Communities (80 total, 15 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (83): CacheFreshnessControlsProps, CacheFreshnessPill(), CacheFreshnessPillProps, formatRelativeAge(), STATUS_CLASSES, ensureBotChain(), RPC_BATCH_SIZE, decodeClaimTuple() (+75 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (42): CandidatePayload, cleanCandidate(), parseModelJson(), personaAddress(), POST(), GET(), personaAddress(), POST() (+34 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (36): DashboardPageClient(), listItemEase, DashboardKpiSkeletonRow(), clamp01(), DashboardPortfolioSection(), ease, HOLDING_SEARCH_FIELDS, holdingMatchesDashboardSearch() (+28 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (42): applyFetcherTrust(), CHALLENGE_CONFIDENCE, CHALLENGE_STAKE_USDT, challengedClaimIds, ClaimOnChain, CONTRACT_ADDRESS, COUNCIL_ALPHA, COUNCIL_BONUS_BOT (+34 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (34): dynamic, ModerationRequestBody, POST(), ClaimModerationDecision, ClaimModerationResult, ClaimModerationViolationCode, clampInt(), GeminiModerationPayload (+26 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (34): AnimatedStatNumber(), formatStat(), HeroAscii, HomePage(), ParsedStat, parseStat(), formatChallengers(), VsChallengersCard() (+26 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (41): buildClaimUpsertStatement(), buildIndexedClaimRecord(), buildPool(), ChallengeOpportunityRow, ClaimFilters, ensureSchema(), execute(), getActiveChallengeOpportunities() (+33 more)

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (37): main(), main(), main(), activeLLMKeyFingerprint(), activeLLMModel(), activeLLMProvider(), callAnthropic(), callGemini() (+29 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (33): runPersonaForClaim(), createClaim(), challengeIfMispriced(), agentContractWrite(), ensureAgentUsdtAllowance(), transferUsdt(), botchainTestnet, createBotchainWalletClientWithKey() (+25 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (37): buildCandidateSignature(), CANCEL_DELAY_MS, ClaimCandidate, CONTRACT_ADDRESS, CREATE_DELAY_MS, CREATOR, CREATOR_ADDR_LC, CREATOR_PAYER (+29 more)

### Community 10 - "Community 10"
Cohesion: 0.10
Nodes (30): ACTIVE_PERSONAS, CONTRACT_ADDRESS, DECISION_DELAY_MS, fetchClaim(), MAX_CLAIMS_PER_CYCLE, PEER_READ_CAP_BOT, PEER_READ_DELAY_MS, PEER_READS_PER_PERSONA (+22 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (20): Artifact(), ArtifactProps, ArtifactStamp(), generateSerial(), ControlPanelProps, DataBadge(), SegmentedSwitch(), AvatarProps (+12 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (26): COUNCIL_PERSONAS, getPersonaByAddress(), getPersonaBySlug(), personaAddressEnv(), PersonaArchetype, personaEnvSlug(), personaPrivateKeyEnv(), RuleEvaluator (+18 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (24): dynamic, GET(), getStatusForMessage(), dynamic, GET(), isAuthorized(), maxDuration, dynamic (+16 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (25): evaluateClaimAsPersona(), PersonaVerdict, allocateBonus(), BONUS_DUST_BOT, BonusReceipt, clampQ(), CouncilVerdict, CouncilVote (+17 more)

### Community 15 - "Community 15"
Cohesion: 0.09
Nodes (15): AgentPeep(), C, CouncilNanopaymentMeshDiagram(), diagramAvatar(), JuryDiagram(), ArenaCard(), ArenaCardProps, ArenaStatusKey (+7 more)

### Community 16 - "Community 16"
Cohesion: 0.10
Nodes (19): ArenaViewMode, ExploreClient(), getOpportunityDeadlineValue(), getOpportunitySearchBlob(), sortOpportunities(), ExplorePageProps, EmptyState(), EmptyStateProps (+11 more)

### Community 17 - "Community 17"
Cohesion: 0.09
Nodes (21): buildDesignPreviewRematchChain(), buildDesignPreviewVs(), isDesignPreviewOneVsOneBase(), ProgressBarProps, RESOLVE_PHASE_MS, ProvenStamp(), ProvenStampProps, ResolutionTerminal() (+13 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (24): buyPeerReasoning(), payingWalletForPersona(), PeerReasoningRead, ReasoningResponse, selectPeerSellers(), ClaimCandidateForPreflight, CouncilPreflightOpinion, CouncilPreflightResult (+16 more)

### Community 19 - "Community 19"
Cohesion: 0.10
Nodes (24): ChallengeExampleRow, CreatePage(), formatLocalDateInputValue(), isPresetStakeAmount(), MARKET_TYPES, normalizeSupportedMarketType(), parseChallengeExamples(), STAKE_PRESET_AMOUNTS (+16 more)

### Community 20 - "Community 20"
Cohesion: 0.16
Nodes (23): AgentWriteArgs, councilAddressEnv(), councilEnvSlug(), councilPrivateKeyEnv(), getCouncilWallet(), getCreatorWallet(), getOracleWallet(), loadAgentWallet() (+15 more)

### Community 21 - "Community 21"
Cohesion: 0.14
Nodes (27): getClaim(), getClaimSummaries(), getClaimWithAccess(), batchWrite(), ChallengerRow, ClaimRow, upsertChallengers(), upsertClaimsBatch() (+19 more)

### Community 22 - "Community 22"
Cohesion: 0.07
Nodes (28): deploy, dom, dom.iterable, esnext, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (24): ClaimDraftRequestBody, dynamic, POST(), EvidenceSnapshot, BLOCKED_SOURCE_HOSTS, callGeminiDraftModel(), ClaimDraftRequest, classifySourceType() (+16 more)

### Community 24 - "Community 24"
Cohesion: 0.14
Nodes (21): Input, InputProps, VsXmtpChatPreviewShell(), VsXmtpChatPreviewShellProps, formatMessageTime(), hiddenMyMessagesStorageKey(), vsPanelPageShell(), VsXmtpPanel() (+13 more)

### Community 25 - "Community 25"
Cohesion: 0.15
Nodes (21): useDashboardFilterUrlState(), useExploreFilterState(), DashboardFilterUrlState, DashboardUrlTab, DEFAULT_DASHBOARD_FILTER_URL_STATE, parseDashboardCategory(), parseDashboardUrlSearchParams(), serializeDashboardUrlState() (+13 more)

### Community 26 - "Community 26"
Cohesion: 0.08
Nodes (25): @anthropic-ai/sdk, concurrently, @fontsource/maple-mono, framer-motion, next, dependencies, @anthropic-ai/sdk, concurrently (+17 more)

### Community 27 - "Community 27"
Cohesion: 0.12
Nodes (11): Props, Footer(), HtmlLang(), PageFrame(), ScrollToTopOnLoad(), shouldForceTop(), SkipToContentLink(), { Link, redirect, usePathname, useRouter } (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (21): ClaimStrengthCard(), ClaimStrengthCardProps, ClaimStrengthModeration, ClaimStrengthModerationStatus, tierClasses, confidenceClasses, ConfidenceTier, getConfidenceTier() (+13 more)

### Community 29 - "Community 29"
Cohesion: 0.14
Nodes (20): POST(), VerdictRequest, extractJson(), CLOUDFLARE_MARKERS, decodeEntities(), DirectFetchResult, EvidenceFetchError, extractJinaTitle() (+12 more)

### Community 30 - "Community 30"
Cohesion: 0.12
Nodes (15): EmergingNarrativesClient(), EmergingNarrativesPageProps, BlueprintHeading(), DashboardWalletGate(), DashboardWalletGateProps, AnimatedItem(), container, itemVariants (+7 more)

### Community 31 - "Community 31"
Cohesion: 0.17
Nodes (16): MessagesPageProps, MessagesHub(), truncateQuestion(), ZERO_ADDRESS, getVSConfiguredMaxChallengers(), MOCK_CREATED_VS_ID, canOpenVsXmtpChat(), getVsXmtpPeerAddress() (+8 more)

### Community 32 - "Community 32"
Cohesion: 0.09
Nodes (18): DirectionalGlow(), OppositionLayoutProps, activityPulse, fusePulse, kineticContainer, kineticLetter, numberRoll, PHASE_COLORS (+10 more)

### Community 33 - "Community 33"
Cohesion: 0.23
Nodes (20): CouncilResponse, GET(), revalidate, fetchAgentAddressesUncached(), fetchEventsUncached(), ARCHETYPE_LABEL, CouncilPage(), fetchCouncilStats() (+12 more)

### Community 34 - "Community 34"
Cohesion: 0.14
Nodes (20): dynamic, GET(), buildDetailCacheFreshness(), buildListCacheFreshness(), challengerRowsToClaimChallengers(), claimRowToClaimData(), claimRowToVSData(), getReferenceUpdatedAt() (+12 more)

### Community 35 - "Community 35"
Cohesion: 0.16
Nodes (18): assertHexAddress(), createXmtpSignerFromEthereum(), EthereumEip1193Provider, hexSignatureToUint8Array(), mapProviderError(), utf8MessageToHexData(), XmtpSignerError, XmtpSignerErrorCode (+10 more)

### Community 36 - "Community 36"
Cohesion: 0.22
Nodes (18): getSeedChallengeOpportunities(), CHALLENGE_OPPORTUNITY_SOURCES, ChallengeOpportunitySource, buildChallengeOpportunityInsertStatement(), replaceChallengeOpportunities(), buildChallengeOpportunitiesForLocale(), buildSeedOpportunities(), dedupeOpportunities() (+10 more)

### Community 37 - "Community 37"
Cohesion: 0.10
Nodes (20): scripts, agents:balances, agents:create-wallets, agents:fund, build, clean, council, demo:cycle (+12 more)

### Community 38 - "Community 38"
Cohesion: 0.13
Nodes (17): CreateSuccessScreen(), sealStamp, BOTCHAIN_EXPLORER_URL, CATEGORIES, CATEGORY_GUIDANCE, CategoryGuidance, DEADLINE_PRESET_IDS, DEADLINE_PRESET_SECONDS (+9 more)

### Community 39 - "Community 39"
Cohesion: 0.19
Nodes (15): useVsXmtpThread(), UseVsXmtpThreadOptions, UseVsXmtpThreadResult, VsXmtpThreadError, VsXmtpThreadPhase, classifyXmtpThreadError(), ensureVsDmThread(), loadThreadMessages() (+7 more)

### Community 40 - "Community 40"
Cohesion: 0.15
Nodes (11): fontBody, fontDisplay, fontMono, APP_METADATA, wagmiConfig, WC_PROJECT_ID, queryClient, WagmiProviders() (+3 more)

### Community 41 - "Community 41"
Cohesion: 0.20
Nodes (15): ActorTag(), AgentsPage(), EventRow, fetchAgentAddresses, fetchEvents, parseFilter(), revalidate, SIDE_LABEL (+7 more)

### Community 42 - "Community 42"
Cohesion: 0.16
Nodes (15): compileMimir(), DEPLOY_ABI, getKey(), main(), prompt(), BOT_DECIMALS, BOT_UNIT, BOTCHAIN_HTTP_OPTS (+7 more)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (17): autoprefixer, devDependencies, autoprefixer, postcss, solc, tailwindcss, @types/node, @types/react (+9 more)

### Community 44 - "Community 44"
Cohesion: 0.14
Nodes (14): EN_SEEDS, ES_SEEDS, SeedChallengeOpportunity, ChallengeOpportunitiesResponse, ChallengeOpportunityAction, ChallengeOpportunityStrengthTier, CLAIM_DRAFT_CATEGORY_IDS, CLAIM_DRAFT_SOURCE_TYPES (+6 more)

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (14): buildAuxiliaryOutcomePair(), buildBareVerbOutcomePair(), buildEventOutcomePair(), buildWeatherOutcomePair(), capitalizeDraftText(), draftOutcomeSidesFromQuestion(), EVENT_NOUN_HINTS, EVENT_VERB_NOUNS (+6 more)

### Community 46 - "Community 46"
Cohesion: 0.19
Nodes (11): ClaimRow, fetchClaims, fetchOracleAndCreator, fetchSettlements, fetchStakers, revalidate, Settlement, SIDE_LABEL (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.41
Nodes (12): SettlementTeaser(), StakeHoldingVSRow(), vsRowInsetPresenceClass(), didUserChallengeVS(), didUserLoseVS(), didUserWinVS(), getVSUserChallenger(), getVSUserChallengerStake() (+4 more)

### Community 48 - "Community 48"
Cohesion: 0.35
Nodes (9): Header(), useWallet(), getXmtpAppVersion(), getXmtpClientCreateOptions(), getXmtpEnv(), isXmtpFeatureEnabled(), parseXmtpEnv(), XMTP_ENV_VALUES (+1 more)

### Community 49 - "Community 49"
Cohesion: 0.17
Nodes (11): iad1, maxDuration, buildCommand, framework, functions, app/api/**/route.ts, github, silent (+3 more)

### Community 50 - "Community 50"
Cohesion: 0.18
Nodes (10): addrMatch, addrMatch2, blockMatch, blockMatch2, clean(), env, envMap, loadEnvLocal() (+2 more)

### Community 51 - "Community 51"
Cohesion: 0.25
Nodes (7): isTxHash(), PaymentCard(), PaymentEvent, ReceiptLink(), RevenuePage(), RevenueSummary, short()

### Community 52 - "Community 52"
Cohesion: 0.22
Nodes (9): DashboardVSFilterBar(), DashboardVSFilterBarProps, DashboardVSTab, TAB_ORDER, TabItem, CategoryId, DASHBOARD_PANEL_SURFACE, MIN_STAKE_OPTIONS (+1 more)

### Community 53 - "Community 53"
Cohesion: 0.18
Nodes (10): build, buildCommand, builder, deploy, numReplicas, restartPolicyMaxRetries, restartPolicyType, sleepApplication (+2 more)

### Community 54 - "Community 54"
Cohesion: 0.27
Nodes (8): CATEGORY_ACCENTS, ChallengeOpportunityCard(), ChallengeOpportunityCardProps, exploreFilterPanelHeightTransition, getCategoryAccent(), resolveConfidenceClass(), resolveConfidenceKey(), ChallengeOpportunity

### Community 55 - "Community 55"
Cohesion: 0.29
Nodes (7): LiveDeadline(), LiveDeadlineProps, PHASE_CONFIG, CountdownTimer(), CountdownTimerProps, getTimeRemaining(), useCountdown()

### Community 56 - "Community 56"
Cohesion: 0.38
Nodes (9): VSCardProps, VSData, getPendingVS(), mergePendingVS(), PendingVS, readAll(), removePendingVS(), savePendingVS() (+1 more)

### Community 57 - "Community 57"
Cohesion: 0.50
Nodes (8): acquireTxLock(), clearLock(), getLockKey(), getTabId(), LockEntry, normalizeScope(), readLock(), writeLock()

### Community 58 - "Community 58"
Cohesion: 0.48
Nodes (6): generatePrivateInviteKey(), getStoredPrivateInviteKey(), PrivateInviteMap, readInviteMap(), rememberPrivateInviteKey(), writeInviteMap()

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (6): engines, node, license, name, private, version

### Community 60 - "Community 60"
Cohesion: 0.50
Nodes (4): dynamic, GET(), isAuthorized(), maxDuration

### Community 61 - "Community 61"
Cohesion: 0.60
Nodes (4): CreateChallengeTicket(), CreateChallengeTicketProps, formatWalletForTicket(), truncate()

### Community 62 - "Community 62"
Cohesion: 0.60
Nodes (4): CANDIDATE_MODELS, KEYS, main(), probe()

### Community 65 - "Community 65"
Cohesion: 0.50
Nodes (3): createNextIntlPlugin, nextConfig, withNextIntl

## Knowledge Gaps
- **439 isolated node(s):** `POLL_INTERVAL_MS`, `MAX_CLAIMS_PER_CYCLE`, `DECISION_DELAY_MS`, `PEER_READS_PER_PERSONA`, `PEER_READ_DELAY_MS` (+434 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getExplorerTxUrl()` connect `Community 8` to `Community 0`, `Community 33`, `Community 3`, `Community 38`, `Community 9`, `Community 10`, `Community 41`, `Community 42`, `Community 46`, `Community 15`, `Community 17`, `Community 51`, `Community 20`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `createBotchainPublicClient()` connect `Community 33` to `Community 1`, `Community 3`, `Community 8`, `Community 9`, `Community 10`, `Community 41`, `Community 12`, `Community 42`, `Community 46`, `Community 14`, `Community 17`, `Community 18`, `Community 20`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `VSData` connect `Community 56` to `Community 0`, `Community 2`, `Community 36`, `Community 5`, `Community 12`, `Community 44`, `Community 15`, `Community 16`, `Community 17`, `Community 19`, `Community 21`, `Community 24`, `Community 25`, `Community 28`, `Community 31`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `POLL_INTERVAL_MS`, `MAX_CLAIMS_PER_CYCLE`, `DECISION_DELAY_MS` to the rest of the system?**
  _439 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05002337540906966 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07619738751814223 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06509803921568627 - nodes in this community are weakly interconnected._