# Backlog `mcp-kit-js`

Backlog implementacyjny do [SPECIFICATION.md](./SPECIFICATION.md), wersja 0.4.

## Zasady pracy z backlogiem

- `[ ]` oznacza zadanie nierozpoczete albo niezweryfikowane.
- `[x]` oznacza zadanie zaimplementowane i zweryfikowane.
- Checkbox mozna odznaczyc dopiero po przejsciu testow przypisanych do zadania.
- Milestone jest zakonczony dopiero po spelnieniu jego Definition of Done.
- Nowe zadania dopisujemy do odpowiedniego milestone zamiast wykonywac je poza backlogiem.
- Zmiana zakresu lub kolejnosci milestone wymaga aktualizacji tego pliku i specyfikacji.

## Milestone 0: Fundament repozytorium

Cel: przygotowac monorepo, kontrakty pakietow i automatyczna walidacje podstaw projektu.

### Workspace

- [x] Utworzyc root `package.json` z `packageManager`, skryptami workspace i wymaganiem Node.js 22+.
- [x] Dodac `pnpm-workspace.yaml`.
- [x] Utworzyc pakiety `@mcp-kit/core`, `@mcp-kit/node`, `@mcp-kit/testing`, `@mcp-kit/cli` i `create-mcp-kit`.
- [x] Utworzyc katalogi `templates`, `examples`, `test/e2e` i `test/fixtures`.
- [x] Skonfigurowac ESM-only build dla wszystkich publikowanych pakietow.
- [x] Skonfigurowac jawne package exports i generowanie deklaracji TypeScript.
- [x] Dodac wspolny `tsconfig.base.json` z ustawieniami strict.
- [x] Dodac root Vitest workspace.
- [x] Dodac ESLint v10 flat config i Prettier.
- [x] Dodac Knip dla monorepo.
- [x] Dodac podstawowy workflow CI dla lint, typecheck, test i build.

### Zgodnosc

- [x] Wybrac i przypiac pierwsza wspierana wersje oficjalnego TypeScript SDK MCP.
- [x] Udokumentowac pierwsza macierz zgodnosci: mcp-kit, SDK, protokol MCP i Node.js.
- [x] Dodac test CI dla najnizszej i najwyzszej wspieranej wersji Node.js.
- [x] Zdefiniowac polityke aktualizacji SDK i rewizji protokolu.
- [x] Udokumentowac zasade jeden bounded context na wdrazany serwer MCP.
- [x] Dodac architecture decision record dla stateless-first Streamable HTTP.

### Definition of Done

- [x] Czyste checkout repo instaluje sie przez `pnpm install --frozen-lockfile`.
- [x] Wszystkie pakiety przechodza lint, typecheck, test i build.
- [x] Import z root export kazdego pakietu dziala w smoke tescie.

## Milestone 1: Pionowy happy path stdio

Cel: wygenerowac i uruchomic minimalny serwer, ktorego tool jest wywolywany przez prawdziwego klienta MCP.

### Core

- [x] Zdefiniowac stabilny typ `Schema` zgodny z wybrana wersja SDK i Standard Schema.
- [x] Zaimplementowac `defineTool()` z inferencja input/output.
- [x] Zaimplementowac `ToolPolicy` i oficjalne tool annotations.
- [x] Zaimplementowac `RequestContext` z `requestId`, `signal`, `services`, `logger`, informacja o kliencie i escape hatch do SDK.
- [x] Zaimplementowac `defineRegistry()` z walidacja duplikatow i stabilnym sortowaniem bez `localeCompare`.
- [x] Zaimplementowac `createMcpApp()` bez zaleznosci od transportu Node.js.
- [x] Zapewnic kontrolowany `app.sdk` escape hatch.
- [x] Zablokowac rejestracje capabilities po polaczeniu transportu, jesli SDK jej nie wspiera.

### Node stdio

- [x] Zaimplementowac `runStdio(app)`.
- [x] Dodac logger zapisujacy w trybie stdio wylacznie na stderr.
- [x] Dodac obsluge `SIGINT`, `SIGTERM` i graceful shutdown.
- [x] Dodac test wykrywajacy dowolny log aplikacyjny na stdout.

### Generator pierwszej wersji

- [x] Zaimplementowac minimalny wrapper `create-mcp-kit`.
- [x] Wygenerowac domyslna architekture feature-first w TypeScript.
- [x] Dodac `features/health/application/get-health.ts`.
- [x] Dodac `features/health/domain/health-status.ts`.
- [x] Dodac `features/health/mcp/health.tool.ts`.
- [x] Dodac jawny registry i entrypoint stdio.
- [x] Dodac podstawowy README wygenerowanego projektu.

### Testy

- [x] Utworzyc pierwszy real-transport test client.
- [x] Przetestowac initialize i negocjacje wersji protokolu.
- [x] Przetestowac `tools/list`.
- [x] Przetestowac wywolanie `health` przez stdio.
- [x] Przetestowac zamkniecie procesu bez wiszacych uchwytow.
- [x] Dodac E2E: wygenerowanie projektu, instalacja, build i uruchomienie.

### Definition of Done

- [x] `npm create mcp-kit@latest my-server` tworzy projekt w jedynej oficjalnej architekturze.
- [x] Wygenerowany projekt buduje sie i uruchamia lokalnie.
- [x] Klient MCP wywoluje `health` przez stdio i otrzymuje poprawny `CallToolResult`.

## Milestone 2: Podstawowe capabilities MCP

Cel: obsluzyc tools, resources i prompts bez utraty semantyki oficjalnego protokolu.

### Tools

- [x] Obsluzyc pelny `CallToolResult`, w tym wszystkie legalne rodzaje `content`.
- [x] Obsluzyc `structuredContent`, `_meta`, `resource_link` i `isError`.
- [x] Walidowac input przed handlerem.
- [x] Walidowac `structuredContent` wzgledem `outputSchema`.
- [x] Nie modyfikowac po cichu wyniku zwracanego przez handler.
- [x] Propagowac cancellation jako `AbortSignal`.
- [x] Dodac middleware timeout i concurrency limit.
- [x] Dodac progress reporter zalezny od capabilities klienta.

### Resources

- [x] Zaimplementowac `defineResource()` dla statycznego URI.
- [x] Zaimplementowac URI templates i typowane params.
- [x] Obsluzyc pelny `ReadResourceResult`.
- [x] Obsluzyc `text`, `blob` i MIME type.
- [x] Dodac discoverable resource `list` z paginacja i cursors.
- [x] Dodac opcjonalne subscriptions i `list_changed`.

### Prompts

- [x] Zaimplementowac `definePrompt()` z `argsSchema`.
- [x] Obsluzyc pelny wynik promptu i wszystkie legalne content types.
- [x] Walidowac argumenty promptu.
- [x] Dodac testy `prompts/list` i `prompts/get`.

### Bledy i lifecycle

- [x] Zaimplementowac `McpKitError` z bezpieczna wiadomoscia i cause.
- [x] Rozdzielic bledy protokolu od bledow wykonania toola.
- [x] Dodac centralne mapowanie nieoczekiwanych bledow z correlation id.
- [x] Dodac bezpieczne logowanie bez stack trace po stronie klienta.
- [x] Dodac middleware pipeline z jawna kolejnoscia wykonania.

### Testing package

- [x] Zaimplementowac `createMcpTestClient()`.
- [x] Zaimplementowac in-memory harness.
- [x] Zaimplementowac stdio real-transport harness.
- [x] Zaimplementowac `assertToolContracts()`.
- [x] Zaimplementowac `assertResourceContracts()`.
- [x] Zaimplementowac `assertPromptContracts()`.
- [x] Dodac testy unknown capability, invalid input, pagination, cancellation i progress.
- [x] Zintegrowac oficjalny MCP Conformance Test Suite dla wspieranego zakresu.

### Definition of Done

- [x] Wygenerowany serwer przechodzi testy lifecycle, tools, resources i prompts.
- [x] Wspierany zakres przechodzi oficjalny conformance runner.
- [x] Publiczne API nie ogranicza legalnych wynikow wspieranych przez MCP.

## Milestone 3: CLI, generator i presety

Cel: bezpiecznie tworzyc nowe projekty i integrowac framework z istniejacymi repozytoriami.

### Podstawa CLI

- [x] Zaimplementowac parser komend, wspolne exit codes i obsluge bledow.
- [x] Dodac tryb nieinteraktywny `--yes`.
- [x] Dodac `--json` dla komend uzywanych przez automatyzacje.
- [x] Dodac wykrywanie package managera, TypeScript/JavaScript i git root.
- [x] Dodac centralny model planowanych operacji na plikach.

### `mcp-kit new`

- [x] Zaimplementowac tworzenie nowego katalogu.
- [x] Dodac `--transport stdio|http|both`.
- [x] Dodac `--quality off|standard|strict`.
- [x] Dodac `--language typescript|javascript`.
- [x] Dodac `--package-manager`.
- [x] Dodac `--no-git`, `--no-install`, `--no-hooks` i `--no-ci`.
- [x] Zabezpieczyc istniejacy niepusty katalog.
- [x] Dodac bezpieczne zachowanie `--force`.

### `mcp-kit init`

- [x] Zaimplementowac wykrywanie root zgodne ze specyfikacja.
- [x] Dodac `--here`, `--root` i `--dry-run`.
- [x] Dodac `--quality off|standard|strict` bez zmiany architektury projektu.
- [x] Dodac manifest wersji generatora, template, plikow i checksum.
- [x] Zaimplementowac operacje `create`, `merge-json`, `merge-yaml` i `merge-package`.
- [x] Zaimplementowac bezpieczne AST transforms dla wspieranych configow JS/TS.
- [x] Dla nieobslugiwanych konfliktow generowac patch lub `.mcp-kit.conflict`.
- [x] Zapewnic transakcyjny zapis i rollback przy bledzie.
- [x] Zapewnic idempotencje wielokrotnego `init`.
- [x] Nie modyfikowac niezarzadzanych plikow bez jawnej zgody.

### `mcp-kit add`

- [x] Dodac generator toola.
- [x] Dodac generator resource.
- [x] Dodac generator promptu.
- [x] Aktualizowac jawny registry przez AST.
- [x] Generowac test kontraktowy.
- [x] Aktualizowac dokumentacje bez duplikowania wpisow.

### `mcp-kit doctor`

- [x] Walidowac Node.js, package manager i konfiguracje projektu.
- [x] Walidowac registry i scripts.
- [x] Walidowac zgodnosc SDK, protokolu i Node.js.
- [x] Wykrywac osierocone lub zmodyfikowane wpisy manifestu.
- [x] Wykrywac logowanie na stdout w stdio.
- [x] Wykrywac niebezpieczna konfiguracje HTTP.
- [x] Ostrzegac o nadmiernie szerokim lub niespojnym bounded context na podstawie jawnej konfiguracji domeny.
- [x] Wykrywac production HTTP z lokalnym in-memory session/job store.
- [x] Dodac raport tekstowy i JSON.

### Architektura, presety i warianty

- [x] Dokonczyc jeden template feature-first.
- [x] Generowac zawsze `features/<feature>/application` i `features/<feature>/mcp`.
- [x] Dodawac `domain`, `application/ports` i `infrastructure` tylko wtedy, gdy feature ich potrzebuje.
- [x] Zachowac te same reguly zaleznosci niezaleznie od wariantu transportu i presetu jakosci.
- [x] Dodac wariant JavaScript tej samej architektury.
- [x] Dodac presety jakosci off, standard i strict bez zmiany struktury kodu.
- [x] Dodac opcjonalne tryby agentow: none, generic, Claude, Cursor i Codex.
- [x] Dodac E2E dla kazdej kombinacji transportu, presetu i jezyka.

### Definition of Done

- [x] `new` generuje dzialajacy projekt w jednej oficjalnej architekturze.
- [x] `init --yes` jest bezpieczny i idempotentny w istniejacym repo.
- [x] Blad dowolnej operacji zapisu nie pozostawia projektu w stanie czesciowym.

## Milestone 4: Quality i testy architektoniczne

Cel: egzekwowac jedna architekture we wszystkich projektach i dostarczyc skalowalne presety jakosci.

### Quality runner

- [x] Zaimplementowac `defineQualityConfig()`.
- [x] Zaimplementowac `mcp-kit quality --fast`.
- [x] Zaimplementowac `mcp-kit quality --full`.
- [x] Dodac `--fix`, `--json` i lokalna optymalizacje `--since`.
- [x] Orkiestrowac Prettier, ESLint, typed lint, TypeScript, Vitest i Knip.
- [x] Egzekwowac code smells przez SonarJS, niezaleznie od Knip dla dead code.
- [x] Zapewnic poprawne przerwanie procesu i propagacje exit code.
- [x] Dodac czytelny raport czasu i wyniku kazdego kroku.

### Presety coverage

- [x] Preset `off`: brak globalnego coverage gate, ale podstawowe testy architektury pozostaja aktywne.
- [x] Preset `standard`: 90% lines/functions/statements i 85% branches.
- [x] Preset `strict`: konfigurowalne 100% dla jawnie wskazanego kodu.
- [x] Walidowac i raportowac wykluczenia z coverage.
- [x] Pokrywac entrypointy testami integration/smoke.

### Jedna architektura feature-first

- [x] Zaimplementowac reguly dla `features/<feature>/domain`.
- [x] Zaimplementowac reguly dla `features/<feature>/application`.
- [x] Zaimplementowac reguly dla `features/<feature>/mcp`.
- [x] Zaimplementowac reguly dla `features/<feature>/infrastructure`.
- [x] Zakazac importu MCP SDK w domain i application we wszystkich presetach.
- [x] Zakazac importu infrastructure przez application i MCP we wszystkich presetach.
- [x] Wymusic implementowanie application ports przez infrastructure.
- [x] Zezwolic composition root na laczenie wszystkich warstw.
- [x] Zdefiniowac `features/<feature>/index.ts` jako jedyna publiczna granice feature.
- [x] Zakazac importowania prywatnych plikow pomiedzy features.
- [x] Dodac test dozwolonego importu przez publiczny kontrakt feature.
- [x] Wykrywac cykle zaleznosci.
- [x] Dodac podstawowy dependency-cruiser preset dla wszystkich projektow.
- [x] Dodac rozszerzone i bardziej kosztowne kontrole dla presetu strict.
- [x] Dodac testy pozytywne i negatywne kazdej reguly.

### MCP-specific quality rules

- [x] Dodac `no-console-log-in-stdio`.
- [x] Dodac walidacje nazw capability i spojnosci stylu.
- [x] Dodac unikalnosc nazw i deterministyczny registry.
- [x] Dodac spojnosc `policy.effects` z annotations.
- [x] Dodac `protected-capability-requires-policy`.
- [x] Dodac `structured-output-requires-output-schema`.
- [x] Dodac `no-unbounded-list-tool-without-limit`.
- [x] Dodac reguly destructive/open-world hints.
- [x] Dodac `no-raw-error-stack`.

### Git i CI

- [x] Generowac opcjonalny pre-commit `quality --fast`.
- [x] Generowac opcjonalny pre-push `quality --full` tylko dla presetu strict.
- [x] Generowac GitHub Actions `quality --full`.
- [x] Traktowac CI jako rozstrzygajacy quality gate.

### Definition of Done

- [x] `quality --full` przechodzi dla kazdego wariantu oficjalnego template.
- [x] Zepsuty kontrakt MCP powoduje blad quality.
- [x] Niedozwolony import powoduje blad testu architektonicznego niezaleznie od presetu.
- [x] Presety jakosci nie zmieniaja struktury ani kierunku zaleznosci.

## Milestone 5: Streamable HTTP i security

Cel: uruchamiac zdalne serwery MCP z bezpiecznymi ustawieniami domyslnymi.

### Transport HTTP

- [x] Zaimplementowac `runStreamableHttp(app)`.
- [x] Domyslnie bind do `127.0.0.1` w development.
- [x] Wymagac jawnego deployment mode i trusted proxies dla `0.0.0.0`.
- [x] Ustawic stateless jako domyslny tryb production.
- [x] Dodac walidacje `Host` i ochrone DNS rebinding.
- [x] Dodac walidacje `Origin`.
- [x] Dodac bezpieczna, jawna konfiguracje CORS.
- [x] Dodac limity request body, timeoutow i wspolbieznosci.
- [x] Dodac framework-neutralny adapter HTTP.
- [x] Dodac referencyjna integracje Fastify bez wycieku typow Fastify do core.
- [x] Dodac stateless mode bez server-side session state.
- [x] Dodac stateful mode jako jawny opt-in.
- [x] Generowac kryptograficznie losowe session ids.
- [x] Zdefiniowac port `SessionStore`.
- [x] Dodac in-memory `SessionStore` wylacznie dla testow i development.
- [x] Dodac referencyjny adapter Redis lub udokumentowany kontrakt integracyjny.
- [x] Dodac resumability, jesli wspiera ja przypieta wersja SDK.
- [x] Dodac graceful shutdown i drain aktywnych polaczen.
- [x] Nie wlaczac legacy HTTP+SSE bez jawnego adaptera.

### Gateway i skalowanie

- [x] Dodac jawna konfiguracje trusted proxies.
- [x] Poprawnie wyznaczac canonical resource URI za reverse proxy.
- [x] Ufac `Forwarded`/`X-Forwarded-*` tylko od trusted proxies.
- [x] Nie przyjmowac tozsamosci z dowolnych niepodpisanych naglowkow.
- [x] Dodac propagacje correlation id odporna na podszywanie.
- [x] Rozdzielic edge rate limits od limitow per subject/tenant/tool.
- [x] Dodac health, readiness i graceful drain endpoints/hooks.
- [x] Dodac test wieloreplikowy bez sticky sessions.
- [x] Przetestowac requesty jednej sesji kierowane naprzemiennie do dwoch workerow.
- [x] Udokumentowac deployment za API gateway/reverse proxy.

### Auth i policy

- [x] Zdefiniowac rozszerzalny `AuthContext`.
- [x] Zaimplementowac middleware uwierzytelnienia.
- [x] Zaimplementowac domyslna autoryzacje scopes.
- [x] Umozliwic wlasny RBAC/ABAC/tenant authorization.
- [x] Autoryzowac kazdy request niezaleznie od session id.
- [x] Powiazac sesje z subject i tenantem.
- [x] Dodac audit events dla operacji wskazanych przez policy.
- [x] Dodac audit event dla kazdego chronionego tool call z subject, tenant, tool, outcome i correlation id.

### OAuth resource server

- [x] Dodac Protected Resource Metadata.
- [x] Dodac discovery authorization servera.
- [x] Walidowac podpis, issuer, audience i expiry tokenu.
- [x] Obsluzyc minimal scopes i step-up authorization.
- [x] Uniemozliwic token passthrough.
- [x] Dodac consent powiazany z user, client i scopes.
- [x] Dodac port dla downstream credentials/token exchange.
- [x] Udokumentowac integracje z zewnetrznym authorization serverem.

### Ochrona I/O

- [x] Dodac policy filesystem roots.
- [x] Dodac ochrone path traversal i symlink escape.
- [x] Dodac outbound HTTP allowlist i ochrone SSRF.
- [x] Dodac limity rozmiaru wynikow i paginacje.
- [x] Dodac policy dla destrukcyjnych operacji.

### Twarda walidacja tools

- [x] Domyslnie odrzucac nieznane pola input.
- [x] Walidowac limity stringow, kolekcji i zakresow liczbowych.
- [x] Egzekwowac timeout i concurrency per tool.
- [x] Egzekwowac rate limit per subject, tenant i kosztowny tool.
- [x] Walidowac structured output wzgledem output schema.
- [x] Wymagac presentera zamiast surowej odpowiedzi downstream API.
- [x] Dodac policies dla URL, host, filesystem path i innych niebezpiecznych inputow.

### Dlugie operacje

- [x] Zdefiniowac port `JobStore`.
- [x] Zdefiniowac port `JobQueue`.
- [x] Dodac wzorzec start/status/result/cancel niezalezny od transportu.
- [x] Zapewnic przechowywanie job state poza procesem.
- [x] Dodac generator asynchronicznego toola.
- [x] Dodac polling hints i TTL.
- [x] Dodac test restartu workera podczas wykonywania joba.
- [x] Dodac test odebrania wyniku przez inny worker.
- [x] Nie uzywac dlugiego SSE jako jedynego mechanizmu wykonywania joba.
- [x] Przygotowac adapter do natywnego MCP Tasks bez uzalezniania domeny od eksperymentalnego API.

### Testy security

- [x] Przetestowac brak tokenu i niewlasciwy scope.
- [x] Przetestowac zly issuer, audience, podpis i wygasniecie.
- [x] Przetestowac izolacje tenantow.
- [x] Przetestowac session fixation/hijacking i ponowne uzycie session id.
- [x] Przetestowac zly Host, Origin i konfiguracje CORS.
- [x] Przetestowac DNS rebinding protections.
- [x] Przetestowac path traversal, symlink escape i SSRF.
- [x] Przetestowac forged proxy headers i bledna konfiguracje trusted proxy.
- [x] Przetestowac brak sticky sessions i zewnetrzny session store.
- [x] Przetestowac limity per tool oraz odrzucanie nieznanych pol.
- [x] Uruchomic conformance runner dla Streamable HTTP.

### Definition of Done

- [x] Serwer HTTP przechodzi wspierane testy conformance.
- [x] Negatywne testy auth, session, host i origin przechodza.
- [x] Publiczny tryb production nie uruchamia sie bez jawnej decyzji o auth.
- [x] Domyslny production server skaluje sie poziomo bez lokalnego stanu procesu.
- [x] Dlugie operacje przezywaja restart workera i nie wymagaja stalego SSE.

## Milestone 6: Release tooling

Cel: zapewnic powtarzalne budowanie i publikowanie pakietow bez omijania quality gate.

### Quality release

- [x] Zaimplementowac `quality --release`.
- [x] Sprawdzac clean git, wersje i changelog.
- [x] Sprawdzac package exports i liste publikowanych plikow.
- [x] Wykonywac build wszystkich publikowanych pakietow.
- [x] Wykonywac `npm pack` dla kazdego pakietu.
- [x] Instalowac paczki w izolowanym katalogu tymczasowym.
- [x] Testowac root imports, subpath exports, typy i CLI.
- [x] Uruchamiac stdio smoke test z opublikowanego tarballa.
- [x] Uruchamiac HTTP smoke test, gdy transport jest wlaczony.

### Release command i CI

- [x] Zaimplementowac `mcp-kit release` jako prepare-only.
- [x] Dodac jawne `mcp-kit release --publish`.
- [x] Dodac `prepublishOnly`.
- [x] Dodac GitHub Actions release workflow.
- [x] Dodac provenance i rekomendowane npm trusted publishing.
- [x] Dodac ochrone przed publikacja z niewlasciwej galezi lub wersji.
- [x] Udokumentowac standardowa procedure release i rollback.

### Definition of Done

- [x] Standardowa sciezka publikacji zawsze wykonuje `quality --release`.
- [x] Opublikowane tarballe przechodza smoke test w czystym projekcie.
- [x] CLI dziala po instalacji z wygenerowanego tarballa.

## Milestone 7: Mutation testing

Cel: dodac opcjonalna walidacje skutecznosci testow bez obciazania podstawowego workflow.

- [x] Dodac bazowa konfiguracje StrykerJS.
- [x] Dodac `mcp-kit quality --mutation`.
- [x] Ustawic domyslny prog 80%.
- [x] Udokumentowac rekomendowany prog 90% dla dojrzalych projektow.
- [x] Dodac konfigurowalne wykluczenia z uzasadnieniem.
- [x] Dodac nightly GitHub Actions workflow.
- [x] Dodac opcjonalne egzekwowanie mutation score w release.
- [x] Dodac raport tekstowy i HTML.

### Definition of Done

- [x] Mutation score ponizej progu konczy pipeline bledem.
- [x] Mutation testing pozostaje opcjonalne poza jawnie skonfigurowanym release.

## Milestone 8: Funkcje MCP po MVP

Cel: rozszerzac framework dopiero po ustabilizowaniu podstawowego runtime i tooling.

### Capabilities

- [x] Dodac completions.
- [x] Dodac roots z kontrola capabilities klienta.
- [x] Dodac sampling z kontrolowanym bledem przy braku wsparcia klienta.
- [x] Dodac form i URL elicitation.
- [x] Dodac jawne zasady zakazujace sekretow w form elicitation.
- [ ] Dodac tasks po ustabilizowaniu funkcji w protokole i SDK.

### Runtime i ekosystem

- [x] Ocenic adapter Web Standard dla Deno, Bun i edge runtimes.
- [x] Ocenic integracje Express i Hono bez duplikowania oficjalnego SDK.
- [x] Ocenic wydzielenie `@mcp-kit/security`.
- [x] Ocenic wydzielenie `@mcp-kit/quality`.
- [x] Ocenic wydzielenie `@mcp-kit/architecture`.
- [x] Dodac migration guides dla breaking changes.

### Definition of Done

- [ ] Kazda nowa capability ma testy integracyjne i conformance.
- [ ] Funkcje eksperymentalne sa za jawnymi feature flags.
- [ ] Rozszerzenia nie powiekszaja minimalnego happy path bez potrzeby.

## Globalne kryteria wydania 1.0

- [x] Publiczne API core jest udokumentowane i ma polityke kompatybilnosci semver.
- [x] Macierz SDK/protokol/Node jest opublikowana i testowana.
- [ ] Wszystkie oficjalne warianty jednego template przechodza E2E.
- [ ] Stdio i Streamable HTTP przechodza wspierany zakres conformance.
- [x] Wszystkie projekty uzywaja jednej architektury feature-first.
- [x] Presety off/standard/strict zmieniaja rygor quality, ale nie konwencje kodu.
- [ ] Referencyjny production deployment jest stateless-first i nie wymaga sticky sessions.
- [ ] Stateful sessions oraz joby uzywaja zewnetrznych store przez frameworkowe porty.
- [ ] Gateway deployment zachowuje walidacje tokenu, autoryzacje, limity i audit w serwerze.
- [ ] Dlugie operacje uzywaja job/task pattern i przezywaja restart workera.
- [x] CLI jest idempotentne, transakcyjne i bezpieczne dla niezarzadzanych plikow.
- [x] Dokumentacja zawiera tutorial, API reference, security guide i migration guide.
- [x] Release tarball smoke tests przechodza dla wszystkich publikowanych pakietow.

## Audit follow-up: production hardening

### P1

- [x] Zaciesnic typ `McpApp.resources()` tak, zeby nie przyjmowal registry tooli ani promptow.
- [x] Naprawic kontrakt `trustedProxies`: dodac CIDR matching albo usunac CIDR z dokumentacji.
- [x] Zaostrzyc walidacje `Host`: host bez portu nie powinien domyslnie pasowac do dowolnego portu.
- [x] Przeniesc rate limit i concurrency z procesowych `WeakMap` do portow/store'ow z adapterem in-memory.

### P2

- [x] Dodac fazy middleware albo jawny ordered pipeline dla policy, handlera, wyniku i bledow.
- [x] Nie zwracac surowego `error.message` z HTTP runtime dla nieoczekiwanych 500.
- [x] Dac `context.io.http.fetch()` egzekwujacy SSRF guard zamiast polegac tylko na `assertAllowed(url)`.
- [x] Rozdzielic dokumentacje statusu projektu od planow i eksperymentow.

### P3

- [x] Dodac observability jako first-class API: metryki per tool, latency, denied, rate-limit i timeout counters.
- [x] Dodac idempotency dla write tools przez `idempotencyKey` i store deduplikacji.
- [x] Posprzatac `defineRegistry()`: comparator dla rownosci i nieuzywany indeks.

## Production readiness roadmap

Cel: domknac roznice miedzy frameworkiem wygodnym lokalnie a frameworkiem, ktoremu mozna powierzyc realne operacje produkcyjne. Kolejnosc jest priorytetem implementacji.

### 1. Production stores jako publiczne porty

- [x] Uporzadkowac publiczne porty produkcyjnego stanu: `SessionStore`, `StreamableHttpEventStore`, `JobStore`, `JobQueue`, `RateLimitStore`, `ConcurrencyStore`, `AuditStore` i `IdempotencyStore`.
- [x] Rozdzielic kontrakty store od adapterow in-memory tak, zeby in-memory bylo jawnie opisane jako dev/test.
- [x] Dodac runtime/doctor warning albo blad dla production HTTP, gdy aktywny jest in-memory store dla sesji, eventow, jobow, rate limitow, concurrency, audytu albo idempotency.
- [ ] Dodac referencyjne adaptery Redis dla session, event, job queue, rate limit, concurrency i idempotency.
- [ ] Dodac referencyjne adaptery Postgres dla job store, audit store i idempotency store.
- [ ] Dodac testy wieloprocesowe albo wieloinstancyjne pokazujace, ze limity, idempotency, event replay i joby dzialaja poza jednym procesem.
- [ ] Udokumentowac minimalne gwarancje kazdego store: atomicznosc, TTL, cleanup, retry, lease, ordering i wymagania indeksow.

### 2. Observability first-class

- [ ] Rozszerzyc `observability` z pojedynczego hooka na publiczne API: `tracer`, `meter`, `logger`, `redact`.
- [ ] Zdefiniowac domyslne metryki: `mcp_tool_calls_total`, `mcp_tool_errors_total`, `mcp_tool_duration_ms`, `mcp_tool_denied_total`, `mcp_tool_timeout_total`, `mcp_http_requests_total`, `mcp_active_sessions`.
- [ ] Dodac OpenTelemetry spans per request, tool, resource i prompt bez uzalezniania core od konkretnego eksportera.
- [ ] Dodac redakcje atrybutow observability przed logami, metrykami i spanami.
- [ ] Dodac testy, ze denied, rate limit, timeout, concurrency limit i unexpected error trafiaja do metryk z poprawnym outcome.
- [ ] Udokumentowac mapping outcome, atrybuty metryk, cardinality rules i przyklady integracji OTel/Prometheus.

### 3. Bezpieczny HTTP client dla `context.io.http.fetch`

- [ ] Rozszerzyc `context.io.http.fetch(url, options)` o DNS resolve przed requestem i weryfikacje IP po resolve.
- [ ] Blokowac prywatne, loopback, link-local, multicast i metadata IP po DNS resolve, chyba ze policy jawnie pozwala.
- [ ] Weryfikowac kazdy redirect osobno i domyslnie ograniczyc albo wylaczyc automatyczne redirecty.
- [ ] Dodac limity odpowiedzi: maksymalny rozmiar body, maksymalny czas, maksymalna liczba redirectow i dozwolone content types.
- [ ] Dodac timeout i cancellation oparte o `context.signal`.
- [ ] Dodac redakcje URL-i w logach i observability, w tym userinfo, query params i token-like wartosci.
- [ ] Dodac adapter DNS/fetch jako port, z domyslna implementacja Node i mozliwoscia testowania DNS rebinding.
- [ ] Dodac testy DNS rebinding, public host -> private IP, redirect do private IP, duze body, timeout i cancellation.

### 4. Idempotency dla write tools

- [ ] Rozszerzyc `policy.idempotency` o `ttlMs`, np. `{ keyField: 'idempotencyKey', ttlMs: 86400000 }`.
- [ ] Wymagac `ttlMs` albo jawnej decyzji domyslnej dla production store.
- [ ] Zdefiniowac atomowy kontrakt `IdempotencyStore`: reserve, complete, replay result, fail/retry oraz cleanup.
- [ ] Obslugiwac rownolegle wywolania z tym samym idempotency key bez podwojnego wykonania handlera.
- [ ] Zapisywac tylko bezpieczny, stabilny wynik idempotentny; nie zapisywac transient errorow bez jawnej decyzji.
- [ ] Powiazac klucz z tool, subject, tenant i opcjonalnym client id.
- [ ] Dodac testy retry write toola, race condition, TTL expiry, cross-tenant isolation i restart z zewnetrznym store.

### 5. Status i stability contract API

- [ ] Dodac jawny status kazdego publicznego elementu API: `stable`, `experimental`, `internal`, `deprecated`.
- [ ] Dodac status do reference docs dla pakietow, subpath exports, typow, opcji, CLI commands i generatorow.
- [ ] Dodac strone statusu z sekcjami: Implemented, Conformance-tested, Experimental, Planned, Not supported.
- [ ] Dodac test albo lint docs, ktory wykrywa publiczny export bez statusu stabilnosci.
- [ ] Dodac changelog discipline dla przejsc `experimental -> stable`, deprecations i removals.
- [ ] Rozdzielic status implementacji od planow w backlogu, specyfikacji i docsach.

### 6. Production deployment example

- [ ] Dodac `examples/production-http/` jako uruchamialny przyklad produkcyjny.
- [ ] Dodac `Dockerfile` i `docker-compose.yml`.
- [ ] Dodac Redis dla session, event replay, job queue, rate limit, concurrency i idempotency.
- [ ] Dodac Postgres dla job store i audit store, jesli adaptery Postgres beda dostepne.
- [ ] Dodac reverse proxy config z trusted proxies, Host validation, TLS termination assumptions i forwarded headers.
- [ ] Dodac OIDC/JWT auth z Protected Resource Metadata.
- [ ] Dodac OpenTelemetry collector, eksport metryk i przykladowe dashboard-friendly nazwy metryk.
- [ ] Dodac health, readiness, drain i graceful shutdown.
- [ ] Dodac smoke/e2e test przykladu produkcyjnego w CI albo jako release-quality check.

### 7. Secrets API

- [ ] Dodac port sekretow `context.secrets.get(name)`.
- [ ] Dodac policy `secrets: readonly string[]` na toolach i promptach, z walidacja dozwolonych nazw.
- [ ] Zablokowac dostep do sekretu, jesli capability nie deklaruje go w policy.
- [ ] Zapewnic, ze sekret nie trafia do structured output, logow, audit events, observability, promptow, sampling ani elicitation.
- [ ] Dodac redakcje sekretow i secret-like wartosci w loggerze oraz observability.
- [ ] Dodac adaptery dev/test i dokumentowany kontrakt produkcyjny dla secret managerow.
- [ ] Dodac testy braku wycieku sekretu przez output, bledy, logi, sampling, elicitation i audit.

### 8. Capability manifest i docs generator

- [ ] Dodac `mcp-kit inspect --json` generujacy manifest tools, resources, prompts, policies i required scopes.
- [ ] Dodac `mcp-kit generate-docs` generujacy dokumentacje capabilities z manifestu.
- [ ] Uwzglednic input schema, output schema, descriptions, effects, scopes, idempotency, secrets, outbound HTTP, filesystem i destructive policy.
- [ ] Dodac tryb CI porownujacy manifest z commited snapshotem.
- [ ] Dodac format JSON stabilny dla hostow, audytu i narzedzi security review.
- [ ] Dodac testy, ze manifest nie zawiera sekretow ani danych runtime.

### 9. Policy presets

- [ ] Dodac presety `readOnlyTool()`, `writeTool()`, `destructiveTool()`, `externalHttpTool()`, `filesystemTool()`.
- [ ] Presety maja ustawiac sensowne domyslne policy, annotations, output limits, idempotency i wymagania confirmation, a nie tylko skracac skladnie.
- [ ] Zapewnic kompozycje presetow bez konfliktow i bez ukrytych override.
- [ ] Dodac testy, ze presety generuja bezpieczne policy i zgodne annotations.
- [ ] Udokumentowac kiedy uzyc presetow, a kiedy pisac policy recznie.

### 10. Contract snapshots w `@mcp-kit/testing`

- [ ] Dodac `expectMcpContract(app).toMatchSnapshot()`.
- [ ] Snapshot ma obejmowac nazwy tools/resources/prompts, input schema, output schema, descriptions, scopes, effects, idempotency i security policies.
- [ ] Zapewnic stabilna kolejnosc i format snapshotu bez wartosci runtime.
- [ ] Dodac opcje maskowania pol eksperymentalnych i ignorowania opisow, jesli projekt tego chce.
- [ ] Dodac testy wykrywajace przypadkowa zmiane nazwy toola, schema, scope i opisu.
- [ ] Udokumentowac workflow aktualizacji snapshotow w PR.
