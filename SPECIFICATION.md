# Specyfikacja techniczna projektu `mcp-kit-js`

Wersja: 0.4
Status: draft
Zakres: framework TypeScript/JavaScript dla serwerow MCP uruchamianych na Node.js

## 0. Zasady nadrzedne

Specyfikacja rozroznia trzy niezalezne obszary:

1. runtime API do definiowania i uruchamiania serwera MCP
2. developer tooling do generowania, diagnozowania i testowania projektu
3. polityke jakosci projektu, wybierana przez preset, a nie narzucana przez runtime

Framework ma byc:

- zgodny z oficjalna specyfikacja MCP i zbudowany na oficjalnym TypeScript SDK
- skalowalny: jedna architektura obsluguje prosty i rozbudowany serwer
- jawny: bez auto-discovery i ukrytego globalnego stanu
- przenosny na poziomie logiki aplikacyjnej, mimo ze MVP wspiera runtime Node.js
- rozszerzalny przez adaptery i middleware, bez uzalezniania domeny od frameworka
- bezpieczny domyslnie, szczegolnie dla Streamable HTTP
- testowalny przez publiczny protokol, nie tylko przez introspekcje definicji

```txt
Minimalny happy path musi pozostac maly.
Architektura pozostaje jedna, niezaleznie od wielkosci projektu.
```

## 1. Cel projektu

`mcp-kit-js` to progresywnie opiniowany framework dla serwerow MCP w TypeScript i JavaScript.

Framework nie ma zastapic oficjalnego SDK MCP. Ma dostarczyc warstwe produkcyjna nad SDK:

- spojna struktura projektu
- jawne definicje tools, resources i prompts
- generator projektu i generator plikow
- quality pipeline
- testy kontraktowe MCP
- testy architektoniczne
- release gate
- integracja z git hooks i CI
- tryb przyjazny dla agentow kodujacych, bez zakladania konkretnego narzedzia

Najwieksza wartosc projektu nie lezy w samym `defineTool()`, tylko w spojnych kontraktach, bezpiecznych adapterach transportu, testach protokolu oraz tooling, ktory moze rosnac razem z projektem.

Framework nie obiecuje, ze sam zestaw regul gwarantuje bezpieczenstwo lub jakosc. Dostarcza bezpieczne ustawienia domyslne, wykrywa klasy bledow i pozostawia jawne punkty rozszerzen.

## 2. Nazwa robocza

Repozytorium:

```txt
mcp-kit-js
```

CLI:

```txt
mcp-kit
```

Pakiety npm:

```txt
@mcp-kit/core
@mcp-kit/node
@mcp-kit/testing
@mcp-kit/cli
create-mcp-kit
```

Pakiety `security`, `quality` i `architecture` powstana dopiero, gdy beda mialy niezalezne, stabilne API. W MVP ich funkcje moga byc modulami w `core`, `testing` lub `cli`.

## 3. Zalozenia techniczne

Runtime:

```txt
Node.js 22 LTS+
```

Jezyk:

```txt
TypeScript first
JavaScript wspierany przez opublikowane API runtime i wygenerowane typy
ESM only
```

Package manager domyslny:

```txt
pnpm
```

Test runner:

```txt
Vitest
```

Coverage:

```txt
off: bez globalnego gate
standard: 90% lines/functions/statements, 85% branches
strict: 100% dla jawnie wskazanego kodu produkcyjnego
```

Lint:

```txt
ESLint v10 flat config
typescript-eslint typed linting
```

Code smells i architektura:

```txt
ESLint rules
custom MCP rules
Knip
dependency-cruiser
```

Mutation testing:

```txt
StrykerJS jako opcja
```

## 4. Non-goals

Projekt nie ma robic:

- wlasnej implementacji protokolu MCP
- wlasnego transportu MCP w MVP
- wlasnego ORM
- wlasnego DI kontenera
- wlasnego test runnera
- zamiennika oficjalnego MCP SDK
- frameworka typu NestJS
- magicznego auto-discovery bez jawnego registry
- ukrywania typow i mozliwosci oficjalnego MCP SDK
- gwarantowania bezpieczenstwa przez heurystyczne skanowanie nazw pol
- wspierania kilku konkurencyjnych konwencji architektonicznych
- implementowania kompletnego systemu OAuth w core

## 4.1 Zakres uniwersalnosci

W MVP "uniwersalny" oznacza:

- obsluge tools, resources i prompts zgodnie z MCP
- wsparcie stdio i Streamable HTTP na Node.js
- brak zaleznosci logiki aplikacyjnej od transportu
- obsluge bibliotek zgodnych ze Standard Schema, jesli wspiera je wybrana wersja oficjalnego SDK
- escape hatch do oficjalnego SDK dla funkcji, ktorych framework jeszcze nie modeluje

Nie oznacza to wsparcia wszystkich runtime, frameworkow HTTP i wersji protokolu od pierwszego wydania.

## 4.2 Jednostka wdrozenia

Domyslna jednostka wdrozenia to maly serwer MCP odpowiadajacy jednemu bounded context:

```txt
github-mcp
billing-mcp
crm-mcp
internal-docs-mcp
```

Framework odradza laczenie niepowiazanych domen w jeden `super-MCP`.

Zasady:

- jeden serwer ma spojny model uprawnien, ownership i cykl wydan
- tools, resources i prompts jednego serwera dotycza jednego bounded context
- wspoldzielone capability pomiedzy domenami trafia do jawnego osobnego serwera albo stabilnego domain API
- wielkosc serwera jest kontrolowana przez lint/doctor metrics, ale framework nie narzuca arbitralnego limitu liczby tools
- rozdzielenie serwerow nie moze prowadzic do wspoldzielonej bazy jako ukrytego kontraktu; integracja odbywa sie przez API, event lub jawny port

## 4.3 Zgodnosc i wersjonowanie

Kazde wydanie frameworka publikuje macierz:

```txt
wersja mcp-kit
wersja oficjalnego TypeScript SDK
obslugiwane rewizje protokolu MCP
obslugiwane wersje Node.js
status funkcji eksperymentalnych
```

Zasady:

- oficjalne typy protokolu sa zrodlem prawdy
- funkcje eksperymentalne MCP sa za jawnymi feature flags
- breaking change w mapowaniu protokolu wymaga major release frameworka
- adapter SDK jest wewnetrzna granica kompatybilnosci
- CI testuje najnizsza i najwyzsza wspierana wersje Node.js

## 5. Glowne decyzje produktowe

### 5.1 Framework cienki, nie ciezki

Framework ma byc cienka, opiniowana warstwa nad oficjalnym MCP SDK.

SDK odpowiada za protokol. `mcp-kit-js` odpowiada za:

- strukture projektu
- konwencje
- testy
- walidacje
- security defaults
- quality gate
- release gate

Framework nie kopiuje calego API SDK pod innymi nazwami. Abstrakcja musi zapewniac co najmniej jedna z wartosci:

- inferencje typow od schema do handlera
- spojne middleware i kontekst requestu
- normalizacje wyniku bez utraty danych MCP
- testowalnosc kontraktu
- bezpieczny lifecycle transportu

Aplikacja ma kontrolowany escape hatch `app.sdk` do funkcji oficjalnego SDK, ktorych framework jeszcze nie modeluje.

### 5.2 `init` i `new` maja rozne znaczenia

Komendy musza miec jednoznaczna semantyke.

```txt
mcp-kit new <name>
```

Tworzy nowy katalog projektu.

```txt
mcp-kit init
```

Inicjalizuje framework w biezacym projekcie albo w root repozytorium git.

Nie wolno robic jednej komendy, ktora czasem tworzy nowy katalog, a czasem modyfikuje obecny katalog.

### 5.3 Brak zalozenia konkretnego agenta kodujacego

Framework ma byc agent-friendly, ale vendor-neutral.

Domyslnie `init` nie zaklada, ze uzytkownik ma Claude Code, Cursor, Windsurf, Codex CLI albo inne konkretne narzedzie.

Wsparcie dla agentow ma byc opcjonalne:

```txt
mcp-kit init --agent none
mcp-kit init --agent generic
mcp-kit init --agent claude
mcp-kit init --agent cursor
mcp-kit init --agent codex
```

Domyslnie:

```txt
--agent none
```

Opcjonalny tryb `generic` moze tworzyc neutralne pliki typu:

```txt
AGENTS.md
.mcp-kit/agent-instructions.md
```

Tryby vendor-specific moga tworzyc pliki specyficzne dla danego narzedzia, ale tylko po jawnym wyborze.

### 5.4 Jedna architektura, rozne presety jakosci

Framework ma jedna konwencje architektoniczna dla wszystkich projektow:

```txt
feature-first + adapter MCP + application + opcjonalne domain/ports/infrastructure
```

Presety zmieniaja wylacznie koszt i rygor automatycznej kontroli:

```txt
off       -> wymagane testy runtime, kontraktu i podstawowych granic architektury
standard  -> lint, typecheck, testy, coverage i CI
strict    -> standard + pelne testy architektoniczne, release gate i ostrzejsze progi
```

Domyslny preset jakosci to `standard`. Preset nie zmienia struktury katalogow, kierunku zaleznosci ani publicznego API.

Wariant JavaScript generuje te sama architekture w plikach `.js`, z `checkJs`/JSDoc tam, gdzie daje to wartosc. Funkcje runtime sa identyczne dla TypeScript i JavaScript; gwarancje compile-time sa naturalnie mocniejsze w TypeScript.

## 6. CLI

### 6.1 `mcp-kit new`

Komenda:

```txt
mcp-kit new users-mcp
```

Zachowanie:

1. tworzy katalog `users-mcp`
2. inicjalizuje git, chyba ze podano `--no-git`
3. tworzy `package.json`
4. tworzy strukture `src`, `test`, `docs`
5. dodaje konfiguracje quality
6. dodaje hooki git, chyba ze podano `--no-hooks`
7. dodaje GitHub Actions, chyba ze podano `--no-ci`
8. dodaje przykladowy tool
9. opcjonalnie dodaje pliki agentow, jesli podano `--agent`
10. instaluje zaleznosci, chyba ze podano `--no-install`

Opcje:

```txt
mcp-kit new <name>
mcp-kit new <name> --yes
mcp-kit new <name> --transport stdio
mcp-kit new <name> --transport http
mcp-kit new <name> --transport both
mcp-kit new <name> --quality off
mcp-kit new <name> --quality standard
mcp-kit new <name> --quality strict
mcp-kit new <name> --language typescript
mcp-kit new <name> --language javascript
mcp-kit new <name> --package-manager pnpm
mcp-kit new <name> --no-git
mcp-kit new <name> --no-install
mcp-kit new <name> --no-hooks
mcp-kit new <name> --no-ci
mcp-kit new <name> --agent none
mcp-kit new <name> --agent generic
mcp-kit new <name> --agent claude
mcp-kit new <name> --agent cursor
mcp-kit new <name> --agent codex
```

Reguly:

- jesli katalog istnieje i nie jest pusty, komenda konczy sie bledem
- `--force` pozwala kontynuowac po wygenerowaniu planu zmian, ale nie kasuje niezarzadzanych plikow
- `--yes` nie moze robic destrukcyjnych zmian
- `--no-git` pomija `git init`

### 6.2 `mcp-kit init`

Komenda:

```txt
mcp-kit init
```

Zachowanie:

1. wykrywa git root
2. wykrywa package manager
3. wykrywa TypeScript albo JavaScript
4. dopisuje potrzebne zaleznosci
5. dodaje `mcp-kit.config.ts`
6. dodaje `quality.config.ts`
7. dodaje testy architektoniczne
8. dodaje testy kontraktowe
9. dodaje hooki git, chyba ze podano `--no-hooks`
10. dodaje CI, chyba ze podano `--no-ci`
11. opcjonalnie dodaje pliki agentow, jesli podano `--agent`
12. nie nadpisuje istniejacych plikow bez strategii merge albo jawnego konfliktu
13. zapisuje manifest plikow i fragmentow zarzadzanych przez mcp-kit
14. wykonuje zmiany transakcyjnie: blad przywraca stan sprzed komendy

Opcje:

```txt
mcp-kit init
mcp-kit init --yes
mcp-kit init --here
mcp-kit init --root .
mcp-kit init --no-install
mcp-kit init --no-hooks
mcp-kit init --no-ci
mcp-kit init --quality off
mcp-kit init --quality standard
mcp-kit init --quality strict
mcp-kit init --dry-run
mcp-kit init --agent none
mcp-kit init --agent generic
mcp-kit init --agent claude
mcp-kit init --agent cursor
mcp-kit init --agent codex
```

Reguly wykrywania katalogu:

1. jesli cwd jest wewnatrz git repo, rootem jest git root
2. jesli cwd nie jest w git repo, ale ma `package.json`, rootem jest cwd
3. jesli cwd jest pusty, `init` moze stworzyc projekt w cwd
4. jesli cwd nie jest pusty i nie ma `package.json`, wymagane jest `--force`
5. `--here` wylacza automatyczne przejscie do git root
6. `--root` jawnie wskazuje katalog

`init --yes` musi byc bezpieczne dla automatyzacji:

- nie nadpisuje niezarzadzanych plikow
- nie robi `git init` w istniejacym repo
- nie robi commita
- nie publikuje paczki
- nie modyfikuje globalnych konfiguracji narzedzi
- nie tworzy vendor-specific plikow agentow bez `--agent`
- przed zapisem prezentuje plan zmian, chyba ze podano `--yes`

### 6.3 `mcp-kit doctor`

Komenda:

```txt
mcp-kit doctor
```

Sprawdza:

- wersje Node
- package manager
- obecnosc `package.json`
- obecnosc `tsconfig.json`
- obecnosc konfiguracji `mcp-kit`
- obecnosc `quality.config.ts`
- obecnosc hookow
- obecnosc CI
- poprawnosc scripts w `package.json`
- poprawnosc MCP registry
- czy quality pipeline przechodzi
- zgodnosc wersji SDK, Node.js i rewizji protokolu
- niespojne lub osierocone wpisy manifestu mcp-kit
- niebezpieczna konfiguracje HTTP
- czy stdio nie zapisuje danych innych niz MCP na stdout

### 6.4 `mcp-kit add`

Komendy:

```txt
mcp-kit add tool get-user
mcp-kit add resource user
mcp-kit add prompt review_user
```

Zachowanie dla `tool`:

1. tworzy plik definicji toola
2. tworzy schema
3. tworzy presenter, jesli potrzebny
4. tworzy test kontraktowy
5. dopisuje eksport do `index.ts`
6. aktualizuje `docs/tools.md`

### 6.5 `mcp-kit quality`

Komendy:

```txt
mcp-kit quality
mcp-kit quality --fast
mcp-kit quality --full
mcp-kit quality --release
mcp-kit quality --mutation
mcp-kit quality --fix
mcp-kit quality --json
mcp-kit quality --since origin/main
```

Domyslnie:

```txt
mcp-kit quality = preset skonfigurowany w projekcie
```

`--since` jest optymalizacja lokalna. W CI dla merge i release wykonywany jest pelny preset, gdy zaleznosci zmienionych plikow nie moga byc wyznaczone wiarygodnie.

### 6.6 `mcp-kit release`

Komenda:

```txt
mcp-kit release
```

Zachowanie:

1. sprawdza clean git
2. odpala `mcp-kit quality --release`
3. sprawdza wersje
4. sprawdza changelog
5. sprawdza package exports
6. buduje paczki
7. wykonuje package smoke test
8. domyslnie przygotowuje release
9. publikuje tylko po jawnym `--publish`

Release automation jest funkcja tooling, a nie warunkiem korzystania z runtime frameworka.

## 7. Monorepo frameworka

```txt
mcp-kit-js
├── packages
│   ├── core
│   ├── node
│   ├── testing
│   ├── cli
│   └── create-mcp-kit
├── templates
│   └── default
├── examples
│   ├── stdio-mcp
│   └── http-mcp
├── docs
├── test
│   ├── e2e
│   └── fixtures
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── eslint.config.js
├── knip.json
├── dependency-cruiser.config.cjs
├── lefthook.yml
└── .github
    └── workflows
        ├── quality.yml
        └── release.yml
```

## 8. Pakiety

### 8.1 `@mcp-kit/core`

Zakres:

- `defineTool`
- `defineResource`
- `definePrompt`
- `createMcpApp` bez zaleznosci od konkretnego transportu
- `registerCapabilities`
- `McpKitError`
- schema helpers
- registry helpers
- middleware pipeline
- typy kontekstu requestu
- adapter zgodnosci z oficjalnym SDK

Publiczne API:

```ts
export { createMcpApp } from './app/create-mcp-app'
export { defineTool } from './tool/define-tool'
export { defineResource } from './resource/define-resource'
export { definePrompt } from './prompt/define-prompt'
export { McpKitError } from './errors/mcp-kit-error'
```

`core` nie narzuca wlasnego typu `Result`. Handlery zwracaja pelny wynik MCP albo wartosc domenowa do jawnego presentera.

### 8.2 `@mcp-kit/node`

Zakres:

- stdio transport
- Streamable HTTP transport
- Node server bootstrap
- process signal handling
- stderr logger dla stdio
- bezpieczne ustawienia HTTP
- lifecycle i graceful shutdown

Adapter HTTP powinien miec framework-neutralny rdzen oparty o Web Standard Request/Response albo waski wewnetrzny kontrakt. Fastify moze byc oficjalna integracja referencyjna dla Node.js, ale publiczne API aplikacji nie moze zalezec od typow Fastify.

### 8.3 `@mcp-kit/testing`

Zakres:

- `assertToolContracts`
- `assertResourceContracts`
- `assertPromptContracts`
- `assertNoSecretLeaks`
- `createMcpTestClient`
- fixtures
- fake auth context
- in-memory i real-transport harness
- adapter do oficjalnego MCP conformance suite
- assertions dla lifecycle, cancellation i capabilities negotiation

### 8.4 `@mcp-kit/cli`

Zakres:

- `mcp-kit` command
- `init`
- `new`
- `add`
- `quality`
- `doctor`
- `release`

CLI orkiestruje istniejace narzedzia projektu. Nie reimplementuje test runnera, lintera ani systemu publikacji.

### 8.5 `create-mcp-kit`

Zakres:

```txt
npm create mcp-kit@latest my-server
```

Wrapper nad:

```txt
mcp-kit new my-server
```

## 9. Generowany projekt

```txt
users-mcp
├── src
│   ├── main.ts
│   ├── app.ts
│   ├── server
│   │   └── transports
│   │       └── stdio.ts
│   ├── mcp
│   │   └── registry.ts
│   ├── features
│   │   └── health
│   │       ├── application
│   │       │   └── get-health.ts
│   │       ├── domain
│   │       │   └── health-status.ts
│   │       └── mcp
│   │           └── health.tool.ts
│   ├── platform
│   │   ├── config.ts
│   │   ├── logger.ts
│   │   ├── security.ts
│   │   └── errors.ts
│   └── shared
├── test
│   ├── unit
│   ├── integration
│   ├── contract
│   │   ├── tools.contract.test.ts
│   │   ├── resources.contract.test.ts
│   │   └── prompts.contract.test.ts
│   ├── architecture
│   │   ├── dependency-rules.test.ts
│   │   ├── mcp-rules.test.ts
│   │   ├── security-rules.test.ts
│   │   └── quality-rules.test.ts
│   └── fixtures
├── docs
│   ├── architecture.md
│   ├── tools.md
│   ├── resources.md
│   ├── prompts.md
│   └── security.md
├── .github
│   └── workflows
│       ├── quality.yml
│       └── release.yml
├── mcp-kit.config.ts
├── quality.config.ts
├── dependency-cruiser.config.cjs
├── eslint.config.js
├── knip.json
├── lefthook.yml
├── vitest.config.ts
├── stryker.config.json
├── tsconfig.json
├── package.json
└── README.md
```

Generator zawsze uzywa tej struktury. Opcje transportu i presetu jakosci dodaja lub pomijaja konfiguracje techniczna, ale nie zmieniaja organizacji kodu aplikacji.

Dla feature bez logiki domenowej wystarczy:

```txt
features/<feature>/application
features/<feature>/mcp
```

Gdy feature wymaga modelu domenowego lub integracji, dodaje:

```txt
features/<feature>/domain
features/<feature>/application/ports
features/<feature>/infrastructure
```

Brak pustego katalogu nie jest inna architektura. Kazdy utworzony katalog ma jedna, stale zdefiniowana odpowiedzialnosc.

Opcjonalne pliki agentow, tylko po jawnym wyborze:

```txt
--agent generic
  AGENTS.md
  .mcp-kit/agent-instructions.md

--agent claude
  .claude/commands/quality.md
  .claude/commands/release.md

--agent cursor
  .cursor/rules/mcp-kit.mdc

--agent codex
  AGENTS.md
```

## 10. Architektura aplikacji MCP

Architektura feature-first jest jedyna oficjalna konwencja frameworka i obowiazuje wszystkie generowane projekty.

Kierunek zaleznosci wewnatrz feature:

```txt
mcp adapter -> application -> domain
infrastructure -> application ports
composition root -> mcp adapter + infrastructure
```

Reguly:

- kod jest grupowany najpierw wedlug feature, potem odpowiedzialnosci
- `domain` nie importuje nic spoza wlasnego domain i `shared`
- `application` nie importuje MCP SDK, `mcp`, `server` ani `infrastructure`
- `mcp` jest adapterem wejscia i importuje tylko application, platform oraz typy frameworka
- `infrastructure` implementuje porty z application
- `mcp` nie importuje infrastructure
- server nie zawiera logiki biznesowej
- tools, resources i prompts sa adapterami
- application jest jedynym miejscem orkiestracji przypadku uzycia
- `app.ts` jest composition root i moze importowac adaptery MCP oraz infrastructure
- feature nie importuje wewnetrznych plikow innego feature; wspoldzielenie odbywa sie przez publiczny kontrakt albo `shared`
- zaleznosci sa przekazywane jawnie; framework nie wymaga globalnego kontenera ani service locatora

Reguly architektoniczne sa zawsze wlaczone w podstawowym zakresie. Preset `strict` dodaje bardziej kosztowne kontrole i ostrzejsze limity, ale nie wprowadza nowych warstw ani innego kierunku zaleznosci.

### 10.1 Dlaczego feature-first

MCP organizuje publiczne API wokol capabilities, ale logika jednego obszaru czesto obejmuje tool, resource i prompt jednoczesnie. Grupowanie najpierw po typie capability prowadzi z czasem do rozrzucenia jednego feature po wielu odleglych katalogach.

Feature-first zapewnia:

- lokalnosc zmian dotyczacych jednego obszaru
- wspolna logike application dla tools, resources i prompts
- izolacje protokolu MCP w adapterach
- mozliwosc usuniecia feature bez przeszukiwania calego projektu
- jednoznaczne granice testow i ownership

### 10.2 Obowiazkowe i opcjonalne elementy feature

Kazdy feature ma:

```txt
application
mcp
```

`domain` powstaje, gdy feature ma reguly lub model niezalezny od przypadku uzycia.

`application/ports` i `infrastructure` powstaja, gdy feature komunikuje sie z baza danych, filesystemem, siecia albo innym zewnetrznym systemem.

To jest jedna architektura z opcjonalnymi odpowiedzialnosciami, a nie zestaw alternatywnych architektur.

### 10.3 Publiczna granica feature

Feature moze wystawic jawny publiczny kontrakt:

```txt
features/<feature>/index.ts
```

Inny feature moze importowac tylko ten kontrakt. Importy do `domain`, `application`, `mcp` lub `infrastructure` innego feature sa zabronione. Preferowana komunikacja miedzy features odbywa sie przez application port, jawna usluge albo zdarzenie domenowe, a nie przez bezposrednie zaleznosci od implementacji.

### 10.4 Referencyjna architektura produkcyjna

```txt
LLM Host / Agent
      |
MCP Client
      |
API Gateway / Reverse Proxy
  - TLS termination
  - edge rate limits
  - request size limits
  - access logs
  - opcjonalna wstepna walidacja tokenu
      |
MCP Server / bounded context
  - Streamable HTTP
  - stateless workers
  - tool/resource/prompt registry
  - schema validation
  - autoryzacja capability i obiektu
  - audit events
      |
Domain APIs / DB / queues / object storage
```

Gateway jest rekomendowana granica edge, ale nie jest zaufanym zamiennikiem kontroli w serwerze. Serwer nadal:

- waliduje token i jego audience albo ufa tylko kryptograficznie zabezpieczonej tozsamosci od skonfigurowanego trusted proxy
- wykonuje autoryzacje per request i per capability
- egzekwuje limity istotne dla logiki domenowej
- waliduje input i output
- emituje audit event z correlation id

Framework nie wymaga konkretnego gatewaya, chmury, bazy ani brokera. Dostarcza kontrakty adapterow i dokumentowane integracje referencyjne.

### 10.5 Stateless-first

Produkcja przez Streamable HTTP jest domyslnie stateless:

- worker nie przechowuje sesji, jobow ani danych uzytkownika w pamieci procesu
- restart lub skalowanie workera nie zmienia zachowania requestu
- brak sticky sessions jest zalozeniem testowanym
- lokalny cache moze byc tylko odtwarzalna optymalizacja, nigdy zrodlem prawdy

Jesli funkcja MCP wymaga stanu, aplikacja uzywa jawnego portu:

```ts
export interface SessionStore {
  get(key: SessionKey): Promise<SessionState | undefined>
  set(key: SessionKey, value: SessionState, ttlMs: number): Promise<void>
  delete(key: SessionKey): Promise<void>
}
```

Implementacja moze uzyc Redis, PostgreSQL lub innego zewnetrznego store. Framework nie uzaleznia publicznego API od konkretnego produktu.

Stateful mode jest opt-in i wymaga:

- zewnetrznego session store dla wdrozenia wieloreplikowego
- TTL i jawnego lifecycle
- powiazania session z subject i tenantem
- odpornosci na rownolegle requesty i race conditions
- testu, w ktorym kolejne requesty trafiaja do roznych workerow

`Mcp-Session-Id` sluzy korelacji logicznej sesji i nigdy nie jest mechanizmem uwierzytelnienia.

## 11. API frameworka

### 11.1 `defineTool`

```ts
import { z } from 'zod'
import { defineTool } from '@mcp-kit/core'

export const getUserTool = defineTool({
  name: 'get-user',
  title: 'Get User',
  description: 'Get user details by id.',
  inputSchema: z.object({
    id: z.string().uuid()
  }),
  outputSchema: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string()
  }),
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false
  },
  policy: {
    effects: 'read',
    requiredScopes: ['users:read']
  },
  handler: async ({ input, context }) => {
    const user = await context.services.users.getUser(input, {
      signal: context.signal
    })

    return {
      structuredContent: user,
      content: [{ type: 'text', text: JSON.stringify(user) }]
    }
  }
})
```

Typ:

```ts
export type ToolDefinition<Input, Output, Services = unknown> = {
  kind: 'tool'
  name: string
  title?: string
  description?: string
  inputSchema: Schema<Input>
  outputSchema?: Schema<Output>
  annotations?: ToolAnnotations
  policy?: ToolPolicy
  handler: (
    args: ToolHandlerArgs<Input, Services>
  ) => Promise<CallToolResult<Output>>
}

export type ToolHandlerArgs<Input, Services> = {
  input: Input
  context: RequestContext<Services>
}

export type ToolPolicy = {
  effects: 'read' | 'write'
  requiredScopes?: string[]
  timeoutMs?: number
  concurrency?: number
  audit?: boolean
}

export type RequestContext<Services> = {
  requestId: string
  signal: AbortSignal
  services: Services
  logger: Logger
  auth?: AuthContext
  client: {
    info?: Implementation
    capabilities: ClientCapabilities
    protocolVersion: string
  }
  progress?: ProgressReporter
  sdk: ServerRequestContext
}
```

Zasady:

- `annotations` mapuja oficjalne hints MCP; framework nie zastepuje ich polami `mutates` i `risk`
- `policy` jest rozszerzeniem frameworka i nie jest wysylane jako standardowy kontrakt MCP
- `policy.effects` sluzy do lokalnego egzekwowania regul i musi byc spojne z oficjalnymi annotations
- framework nie zgaduje annotations na podstawie nazwy toola
- handler moze zwrocic wszystkie legalne rodzaje `content`, `structuredContent`, `resource_link`, `_meta` i `isError`
- jesli istnieje `outputSchema`, framework waliduje `structuredContent`, ale nie usuwa pozostalej czesci wyniku
- anulowanie requestu jest propagowane przez `AbortSignal`
- timeout i limit wspolbieznosci sa middleware/policy, a nie logika handlera

### 11.2 `defineResource`

```ts
import { defineResource } from '@mcp-kit/core'

export const userResource = defineResource({
  name: 'user',
  uriTemplate: 'users://{id}',
  title: 'User',
  description: 'User resource by id.',
  policy: {
    requiredScopes: ['users:read']
  },
  read: async ({ params, context }) => {
    const user = await context.services.users.getUser(
      { id: params.id },
      { signal: context.signal }
    )

    return {
      contents: [
        {
          uri: `users://${params.id}`,
          mimeType: 'application/json',
          text: JSON.stringify(user)
        }
      ]
    }
  }
})
```

Resource definition obsluguje:

- statyczne URI i URI templates
- `list` z paginacja, jesli zasoby sa discoverable
- `read` zwracajace pelny `ReadResourceResult`
- opcjonalne subscriptions i notifications `list_changed`
- MIME type oraz `text` lub `blob`

### 11.3 `definePrompt`

```ts
import { z } from 'zod'
import { definePrompt } from '@mcp-kit/core'

export const reviewUserPrompt = definePrompt({
  name: 'review_user',
  title: 'Review User',
  description: 'Create a concise review of user data.',
  argsSchema: z.object({
    userId: z.string()
  }),
  render: async ({ input }) => {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review user ${input.userId}`
          }
        }
      ]
    }
  }
})
```

### 11.4 `createMcpApp`

```ts
import { createMcpApp } from '@mcp-kit/core'
import { tools } from './mcp/tools'
import { resources } from './mcp/resources'
import { prompts } from './mcp/prompts'
import { createContainer } from './container'

const app = createMcpApp({
  name: 'users-mcp',
  version: '1.0.0',
  services: createServices()
})

app.tools(tools)
app.resources(resources)
app.prompts(prompts)

await runStdio(app)
```

`createMcpApp` nalezy do `core` i nie uruchamia transportu. `runStdio` oraz `runStreamableHttp` naleza do `@mcp-kit/node`. Dzieki temu core nie zalezy od Node.js i pozostaje mozliwy przyszly adapter dla innych runtime.

Rejestracja capabilities musi zakonczyc sie przed polaczeniem transportu. Po starcie dynamiczne zmiany sa dozwolone tylko wtedy, gdy wspiera je SDK i zostaly zadeklarowane odpowiednie notifications.

## 12. Registry

Kazda capability musi byc jawnie zarejestrowana.

```ts
import { healthTool } from './tools/health.tool'
import { healthResource } from './resources/health.resource'
import { reviewPrompt } from './prompts/review.prompt'

export const tools = [healthTool].sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0
)

export const resources = [healthResource].sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0
)

export const prompts = [reviewPrompt].sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0
)
```

Zakaz w MVP:

```txt
auto-discovery plikow
```

Powod: jawny registry jest latwiejszy do testowania, code review i kontroli przez automatyzacje.

Sortowanie nie uzywa `localeCompare`, aby wynik nie zalezal od locale procesu. Framework moze dostarczyc `defineRegistry()`, ktore sprawdza duplikaty i wykonuje stabilne sortowanie.

## 13. Quality pipeline

Quality pipeline jest konfigurowalnym presetem nad standardowymi komendami projektu. Nie jest czescia semantyki runtime i nie moze byc wymagany przez biblioteki `core` lub `node`.

### 13.1 Tryby

```txt
quality --fast
quality --full
quality --release
quality --mutation
```

### 13.2 `quality --fast`

Do pre-commit.

Kolejnosc:

1. detect project
2. validate config
3. format check staged files
4. lint staged files
5. typecheck
6. architecture smoke tests
7. unit tests related to changed files

Wymagania:

- musi byc szybkie
- nie odpala mutation testingu
- nie odpala pelnej integracji
- nie publikuje
- nie modyfikuje plikow bez `--fix`

### 13.3 `quality --full`

Do Pull Request CI oraz opcjonalnego pre-push w presecie strict.

Kolejnosc:

1. env check
2. config check
3. format check all
4. lint all
5. typed lint all
6. code smells
7. typecheck
8. knip
9. dependency-cruiser
10. architecture tests
11. unit tests
12. integration tests
13. MCP contract tests
14. coverage zgodne z presetem
15. build
16. package smoke test

### 13.4 `quality --release`

Do release.

Kolejnosc:

1. `quality --full`
2. clean git check
3. version check
4. changelog check
5. package exports check
6. package files check
7. npm pack dry run
8. install packed package in temp dir
9. run generated smoke test
10. MCP stdio smoke test
11. MCP HTTP smoke test, jesli enabled
12. optional mutation testing

Regula:

```txt
release nie moze przejsc bez quality --release
```

### 13.5 `quality --mutation`

Do release albo nightly.

Kolejnosc:

1. `quality --full`
2. `stryker run`
3. mutation score threshold
4. mutation report

Domyslny threshold:

```txt
80%
```

Rekomendowany threshold dla dojrzalego projektu:

```txt
90%
```

## 14. `quality.config.ts`

```ts
import { defineQualityConfig } from '@mcp-kit/cli'

export default defineQualityConfig({
  preset: 'standard',
  project: {
    root: '.',
    source: ['src/**/*.ts'],
    tests: ['test/**/*.test.ts', 'src/**/*.test.ts']
  },
  formatting: {
    enabled: true,
    command: 'prettier --check .'
  },
  lint: {
    enabled: true,
    command: 'eslint .',
    typed: true
  },
  smells: {
    enabled: true,
    maxCyclomaticComplexity: 8,
    maxCognitiveComplexity: 12,
    maxFunctionLines: 50,
    maxFileLines: 300,
    maxParameters: 4,
    allowLongFiles: ['src/mcp/registry.ts']
  },
  typecheck: {
    enabled: true,
    command: 'tsc --noEmit'
  },
  deadCode: {
    enabled: true,
    command: 'knip'
  },
  architecture: {
    enabled: true,
    command:
      'dependency-cruiser src test --config dependency-cruiser.config.cjs'
  },
  tests: {
    unit: true,
    integration: true,
    contract: true
  },
  coverage: {
    enabled: true,
    thresholds: {
      lines: 90,
      functions: 90,
      statements: 90,
      branches: 85
    },
    include: ['src/**/*.ts'],
    exclude: [
      'src/**/*.d.ts',
      'src/**/index.ts',
      'src/generated/**',
      'src/main.ts'
    ]
  },
  mutation: {
    enabled: false,
    threshold: 90,
    runInRelease: false
  },
  release: {
    requireQuality: true,
    requireCleanGit: true,
    requireChangelog: true,
    requirePackageSmokeTest: true
  },
  hooks: {
    preCommit: 'fast',
    prePush: false
  }
})
```

Preset `standard` uzywa wysokich, ale osiagalnych progow. Preset `strict` moze ustawic 100% dla jawnie wskazanego kodu produkcyjnego. Wykluczenia musza miec uzasadnienie i nie moga sluzyc do ukrywania trudnego kodu; entrypointy sa pokrywane testami smoke lub integration.

## 15. `package.json` generowanego projektu

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx src/main.ts",
    "build": "tsup",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run test/unit src",
    "test:integration": "vitest run test/integration",
    "test:contract": "vitest run test/contract",
    "test:architecture": "vitest run test/architecture",
    "test:coverage": "vitest run --coverage",
    "test:mutation": "stryker run",
    "quality": "mcp-kit quality --full",
    "quality:fast": "mcp-kit quality --fast",
    "quality:full": "mcp-kit quality --full",
    "quality:release": "mcp-kit quality --release",
    "quality:mutation": "mcp-kit quality --mutation",
    "doctor": "mcp-kit doctor",
    "release": "mcp-kit release",
    "prepublishOnly": "mcp-kit quality --release"
  }
}
```

## 16. Git hooks

Domyslnie:

```txt
pre-commit -> quality --fast
pre-push -> brak hooka; quality --full wykonuje CI
```

Opcja strict:

```txt
pre-commit -> quality --fast
pre-push -> quality --full
```

Hooki nie moga byc jedynym mechanizmem egzekwowania jakosci, poniewaz mozna je pominac i bywaja niedostepne w czesci srodowisk. CI jest zrodlem rozstrzygajacym.

`lefthook.yml`:

```yml
pre-commit:
  parallel: false
  commands:
    quality:
      run: pnpm mcp-kit quality --fast
```

## 17. Release gate

Release musi byc zabezpieczony w trzech miejscach:

1. lokalny npm script `release`
2. `prepublishOnly`
3. GitHub Actions release workflow

Regula:

```txt
Nie istnieje oficjalna sciezka release bez mcp-kit quality --release.
```

`prepublishOnly`:

```json
{
  "scripts": {
    "prepublishOnly": "mcp-kit quality --release"
  }
}
```

GitHub Actions release:

```yml
name: Release

on:
  workflow_dispatch:

jobs:
  release:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm mcp-kit quality --release
      - run: pnpm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## 18. CI quality

Pull Request workflow:

```yml
name: Quality

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  quality:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm mcp-kit quality --full
```

Nightly mutation:

```yml
name: Mutation

on:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:

jobs:
  mutation:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm mcp-kit quality --mutation
```

## 19. Testy architektoniczne

### 19.1 Reguly zaleznosci

```txt
feature/domain -> feature/domain + shared
feature/application -> feature/application + feature/domain + shared
feature/mcp -> feature/mcp + feature/application + platform + shared
feature/infrastructure -> feature/infrastructure + feature/application + feature/domain + platform + shared
server -> mcp registry + platform
composition root -> adaptery i implementacje wymagane do zlozenia aplikacji
```

Zakazy:

- feature/domain nie importuje application, mcp, infrastructure, server ani MCP SDK
- feature/application nie importuje MCP SDK, mcp ani infrastructure
- feature/mcp nie importuje infrastructure
- server nie importuje domain bezposrednio
- feature nie importuje prywatnych plikow innego feature
- tylko `app.ts` lub jawny composition root laczy adaptery z infrastructure

### 19.2 `dependency-cruiser.config.cjs`

```js
module.exports = {
  forbidden: [
    {
      name: 'domain-must-not-depend-on-outer-layers',
      from: { path: '^src/features/[^/]+/domain' },
      to: {
        path: '^src/(server|mcp)|^src/features/[^/]+/(application|mcp|infrastructure)'
      },
      severity: 'error'
    },
    {
      name: 'domain-must-not-import-mcp-sdk',
      from: { path: '^src/features/[^/]+/domain' },
      to: { path: '@modelcontextprotocol' },
      severity: 'error'
    },
    {
      name: 'application-must-not-import-mcp-sdk',
      from: { path: '^src/features/[^/]+/application' },
      to: { path: '@modelcontextprotocol' },
      severity: 'error'
    },
    {
      name: 'application-must-not-import-infrastructure',
      from: { path: '^src/features/[^/]+/application' },
      to: { path: '^src/features/[^/]+/infrastructure' },
      severity: 'error'
    },
    {
      name: 'mcp-must-not-import-infrastructure',
      from: { path: '^src/features/[^/]+/mcp' },
      to: { path: '^src/features/[^/]+/infrastructure' },
      severity: 'error'
    },
    {
      name: 'no-circular-dependencies',
      from: {},
      to: { circular: true },
      severity: 'error'
    }
  ],
  options: {
    tsConfig: {
      fileName: 'tsconfig.json'
    }
  }
}
```

## 20. Testy kontraktowe MCP

Testy maja trzy poziomy:

1. statyczne assertions na definicjach i registry
2. testy integracyjne przez `createMcpTestClient`
3. testy conformance przez oficjalny runner MCP dla wspieranych funkcji

Poziom 1 daje szybki feedback, ale nie jest nazywany testem zgodnosci protokolu bez poziomu 2 lub 3.

### 20.1 Tools

Reguly:

- kazdy tool ma `name`
- `name` spelnia ograniczenia aktualnie wspieranej rewizji MCP
- wybrany styl nazw (`kebab-case` albo `snake_case`) jest spojny w projekcie
- `title` i `description` sa wymagane przez domyslny preset `standard`, ale nie sa sztucznym wymogiem protokolu
- kazdy tool ma `inputSchema`
- tool ze structured output ma `outputSchema`
- nazwy tooli sa unikalne
- registry jest posortowany deterministycznie
- mutujacy tool ma poprawne oficjalne annotations
- polityka autoryzacji jest testowana, jesli capability jest chroniona
- wynik handlera jest walidowany jako legalny `CallToolResult`
- `structuredContent` odpowiada `outputSchema`

Test:

```ts
import { describe, expect, it } from 'vitest'
import { tools } from '../../src/mcp/tools'

describe('MCP tool contracts', () => {
  it('all tools have stable contracts', () => {
    for (const tool of tools) {
      expect(tool.name.length).toBeGreaterThan(0)
      expect(tool.inputSchema).toBeDefined()
    }
  })

  it('tool names are unique', () => {
    const names = tools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('tools are sorted by name', () => {
    const names = tools.map((tool) => tool.name)
    expect(names).toEqual([...names].sort())
  })

  it('mutating tools declare annotations and policy', () => {
    for (const tool of tools) {
      const mutating = tool.policy?.effects === 'write'

      if (mutating) {
        expect(tool.annotations?.readOnlyHint).toBe(false)
        expect(tool.policy?.requiredScopes?.length).toBeGreaterThan(0)
      }
    }
  })
})
```

Regex nazwy nie sluzy do zgadywania, czy operacja mutuje dane. Semantyka pochodzi z jawnych annotations i policy.

### 20.2 Resources

Reguly:

- kazdy resource ma `name`
- kazdy resource ma `uri` albo `uriTemplate`
- kazdy resource ma `description`
- kazdy resource ma `requiredScopes`, jesli czyta dane uzytkownika
- uri scheme jest jawny

### 20.3 Prompts

Reguly:

- kazdy prompt ma `name`
- kazdy prompt ma `title`
- kazdy prompt ma `description`
- kazdy prompt ma `inputSchema`
- `render` zwraca poprawny format messages

### 20.4 Lifecycle i zachowanie protokolu

Testy integracyjne sprawdzaja:

- initialize i negocjacje wersji protokolu
- deklarowane server capabilities
- list oraz call/read/get dla zarejestrowanych capabilities
- bledne dane wejsciowe i nieznana capability
- cancellation przez `AbortSignal`
- progress notifications, jesli zadeklarowane
- paginacje i cursors
- notifications `list_changed`, jesli zadeklarowane
- zamkniecie transportu i graceful shutdown
- brak logow aplikacyjnych na stdout dla stdio

### 20.5 Funkcje MCP poza podstawowym MVP

Framework musi miec jawna strategie dla funkcji protokolu, nawet jesli nie wszystkie trafia do pierwszego wydania:

```txt
MVP:
- tools
- resources
- prompts
- logging
- cancellation
- progress
- stdio
- Streamable HTTP

po MVP:
- resource subscriptions
- completions
- roots
- sampling
- elicitation
- tasks, dopoki pozostaja eksperymentalne
```

Handler otrzymuje informacje o capabilities klienta. Proba uzycia sampling, elicitation lub roots bez wsparcia klienta konczy sie kontrolowanym bledem frameworka, a nie wyjatkiem z glebi SDK.

## 21. Testy security

Skanowanie nazw pol jest mechanizmem pomocniczym, nie gwarancja braku wycieku. Framework nie redaguje automatycznie poprawnego wyniku po wykonaniu handlera, poniewaz mogloby to naruszyc `outputSchema` i ukryc blad programisty.

Reguly:

- logi i fixture nie zawieraja znanych sekretow ani tokenow testowych
- output nie zawiera stack trace
- bledy domenowe sa mapowane na bezpieczny MCP error
- high-risk tools wymagaja scopes
- mutating tools wymagaja scopes
- auth context nie moze byc undefined w production mode
- token jest walidowany pod katem issuer, audience, expiry i wymaganych scopes
- token klienta nie jest przekazywany bezposrednio do downstream API
- kazdy request HTTP jest autoryzowany niezaleznie od session id

Przyklad:

```ts
import { describe, expect, it } from 'vitest'
import { assertNoSecretLeaks } from '@mcp-kit/testing'

describe('MCP security', () => {
  it('does not leak known secrets in fixtures', () => {
    expect(() =>
      assertNoSecretLeaks({
        user: {
          id: '123'
        }
      })
    ).not.toThrow()
  })

  it('detects secret leaks', () => {
    expect(() =>
      assertNoSecretLeaks({
        access_token: 'abc'
      })
    ).toThrow()
  })
})
```

Testy security obejmuja rowniez przypadki negatywne: brak tokenu, zly audience, wygasniecie, niewlasciwy tenant, ponowne uzycie session id i probe dostepu do capability bez scope.

## 22. Logging

Reguly:

- przy stdio nie wolno pisac logow na stdout
- logi ida na stderr albo do pliku
- tool result idzie przez MCP response
- `requestId` jest propagowany
- bledy bezpieczenstwa i operacje oznaczone jako audytowane maja audit event

Praktyczna zasada frameworka:

```txt
console.log jest zakazany w src przy transport stdio
```

Regula ESLint:

```txt
no-console: error
```

Wyjatek:

```txt
src/platform/logger.ts
```

## 23. Integracja z agentami kodujacymi

Framework nie zaklada konkretnego agenta.

Cele trybu agent-friendly:

- komendy dzialaja bez interakcji po `--yes`
- `init` dziala w biezacym repo
- CLI daje jasne exit codes
- `quality --json` zwraca maszynowo czytelny raport
- `doctor --json` zwraca maszynowo czytelny raport
- generator nie nadpisuje niezarzadzanych plikow

Opcjonalne tryby integracji:

```txt
--agent none
--agent generic
--agent claude
--agent cursor
--agent codex
```

Domyslnie:

```txt
--agent none
```

### 23.1 `--agent generic`

Tworzy neutralne pliki:

```txt
AGENTS.md
.mcp-kit/agent-instructions.md
```

`AGENTS.md`:

````md
# Agent instructions

Use project scripts instead of ad hoc commands.

Quality:

```txt
pnpm mcp-kit quality --full
```
````

Release:

```txt
pnpm mcp-kit quality --release
```

Rules:

- Do not lower coverage thresholds.
- Do not skip contract tests.
- Do not bypass release quality gate.
- Do not overwrite existing files without checking git diff.

````

### 23.2 `--agent claude`

Tworzy tylko po jawnym wyborze:

```txt
.claude/commands/quality.md
.claude/commands/release.md
.claude/commands/add-mcp-tool.md
````

### 23.3 `--agent cursor`

Tworzy tylko po jawnym wyborze:

```txt
.cursor/rules/mcp-kit.mdc
```

### 23.4 `--agent codex`

Tworzy tylko po jawnym wyborze:

```txt
AGENTS.md
```

## 24. Polityka zapisu plikow przez `init`

`mcp-kit init` musi byc idempotentne.

Reguly:

- drugi init nie psuje projektu
- istniejace pliki nie sa nadpisywane bez merge
- przed zapisem powstaje plan zmian
- przy konflikcie powstaje patch lub `.mcp-kit.conflict`; CLI nie zasmieca projektu automatycznymi `.bak`
- `--yes` nie oznacza `--force`
- `--force` nadal nie kasuje plikow niezarzadzanych przez mcp-kit
- wszystkie zmiany sa raportowane na koncu
- operacja jest transakcyjna
- manifest zapisuje wersje generatora, template oraz checksum zarzadzanych fragmentow

Strategie plikow:

```txt
create        -> utworz, jesli nie istnieje
merge-json    -> scal JSON
merge-yaml    -> scal YAML
merge-package -> dopisz scripts i deps
append-safe   -> dopisz blok oznaczony markerem
conflict      -> zapisz .mcp-kit.conflict
```

Merge uzywa parsera danego formatu. `package.json`, JSON i YAML nie sa modyfikowane przez operacje na surowych stringach. Pliki JS/TS config sa modyfikowane tylko przez bezpieczny AST transform albo pozostawiany jest patch do akceptacji.

Markery:

```txt
# mcp-kit:start
# mcp-kit:end
```

## 25. Konfiguracja `mcp-kit.config.ts`

```ts
import { defineMcpKitConfig } from '@mcp-kit/core'

export default defineMcpKitConfig({
  app: {
    name: 'users-mcp',
    version: '0.1.0'
  },
  source: {
    root: 'src',
    mcp: 'src/mcp',
    features: 'src/features',
    server: 'src/server',
    platform: 'src/platform',
    shared: 'src/shared'
  },
  transport: {
    default: 'stdio',
    http: {
      enabled: false,
      mode: 'stateless',
      host: '127.0.0.1',
      port: 3000,
      path: '/mcp',
      trustedProxies: []
    }
  },
  quality: {
    config: 'quality.config.ts'
  },
  agents: {
    default: 'none',
    configDir: '.mcp-kit'
  }
})
```

## 26. TypeScript config

`tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "test", "*.config.ts"]
}
```

## 27. ESLint config

`eslint.config.js`:

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      'no-console': 'error',
      complexity: ['error', 8],
      'max-lines': [
        'error',
        { max: 300, skipBlankLines: true, skipComments: true }
      ],
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: true, skipComments: true }
      ],
      'max-params': ['error', 4],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error'
    }
  },
  {
    files: ['src/platform/logger.ts'],
    rules: {
      'no-console': 'off'
    }
  }
)
```

## 28. Vitest config

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/generated/**',
        'src/main.ts'
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85
      }
    }
  }
})
```

## 29. Stryker config

`stryker.config.json`:

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "testRunner": "vitest",
  "checkers": ["typescript"],
  "mutate": [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/index.ts",
    "!src/main.ts",
    "!src/generated/**"
  ],
  "thresholds": {
    "high": 90,
    "low": 80,
    "break": 90
  },
  "reporters": ["html", "clear-text", "progress"]
}
```

## 30. Knip config

`knip.json`:

```json
{
  "entry": [
    "src/main.ts",
    "src/mcp/tools/index.ts",
    "src/mcp/resources/index.ts",
    "src/mcp/prompts/index.ts"
  ],
  "project": ["src/**/*.ts", "test/**/*.ts", "*.config.ts"],
  "ignore": ["dist/**", "coverage/**"]
}
```

## 31. Package exports

Kazdy pakiet frameworka musi miec jawne exports.

Przyklad `@mcp-kit/core`:

```json
{
  "name": "@mcp-kit/core",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing.d.ts",
      "import": "./dist/testing.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"]
}
```

Release smoke test musi sprawdzac:

- import z package root
- import z subpath exports
- typy `.d.ts`
- brak importu plikow spoza exports
- dzialanie CLI po `npm pack`

## 32. Obsluga bledow

Typ bledu:

```ts
export class McpKitError extends Error {
  readonly code: string
  readonly safeMessage: string
  readonly cause?: unknown

  constructor(args: {
    code: string
    message: string
    safeMessage?: string
    cause?: unknown
  }) {
    super(args.message)
    this.code = args.code
    this.safeMessage = args.safeMessage ?? 'Operation failed.'
    this.cause = args.cause
  }
}
```

Mapowanie:

```txt
blad danych wejscia/protokolu -> JSON-RPC/MCP protocol error
blad wykonania toola -> CallToolResult z isError true i bezpieczna trescia
blad odczytu resource/prompt -> blad zgodny z typem requestu MCP
AuthorizationError -> bezpieczny blad bez ujawnienia szczegolow policy
UnexpectedError -> bezpieczny blad, correlation id i log po stronie serwera
```

Framework nie zamienia wszystkich wyjatkow w `isError: true`, bo bledy protokolu i bledy wykonania toola maja inna semantyke.

Zakaz:

```txt
Nie zwracamy stack trace do MCP clienta.
```

## 33. Security model

Security ma trzy rozdzielone warstwy:

1. uwierzytelnienie transportu
2. budowa `AuthContext`
3. autoryzacja capability przez policy/middleware

`requiredScopes` nie jest jedynym mozliwym modelem. Aplikacja moze dostarczyc wlasny `authorize`, np. RBAC, ABAC lub polityke tenantowa.

`AuthContext`:

```ts
export type AuthContext = {
  subject?: string
  scopes: string[]
  tenantId?: string
  source: 'anonymous' | 'local' | 'oauth'
}
```

`authorize`:

```ts
export function authorize(context: AuthContext, requiredScopes: string[]) {
  for (const scope of requiredScopes) {
    if (!context.scopes.includes(scope)) {
      throw new McpKitError({
        code: 'FORBIDDEN',
        message: `Missing required scope: ${scope}`,
        safeMessage: 'Permission denied.'
      })
    }
  }
}
```

Reguly:

- kazdy mutujacy tool ma `requiredScopes`
- operacja destrukcyjna ma `destructiveHint: true`
- anonymous context jest dozwolony tylko przez jawna policy
- publiczny remote HTTP wymaga jawnej decyzji o trybie auth; brak auth jest bledem konfiguracji production
- output jest walidowany przed zwroceniem, ale nie jest po cichu modyfikowany
- scope checks nie zastepuja kontroli dostepu do konkretnego obiektu i tenanta

### 33.1 Streamable HTTP

Bezpieczne ustawienia domyslne:

- tryb development binduje do `127.0.0.1`, jesli host nie zostal jawnie ustawiony
- `0.0.0.0` wymaga jawnego trybu deployment i konfiguracji trusted proxies
- tryb production preferuje stateless transport bez `Mcp-Session-Id`
- walidacja `Host` i ochrona przed DNS rebinding
- walidacja `Origin` dla ruchu przegladarkowego
- limity rozmiaru requestu, timeoutow i wspolbieznosci
- kryptograficznie losowe session ids
- session id nie jest mechanizmem uwierzytelnienia
- autoryzacja kazdego requestu
- session jest powiazana z subject/tenant, jesli auth jest wlaczone
- TLS wymagany poza loopback lub zaufanym reverse proxy
- kontrolowana konfiguracja CORS; wildcard nie jest domyslny
- brak legacy HTTP+SSE, chyba ze wlaczono jawny adapter kompatybilnosci

### 33.1.1 Deployment za reverse proxy

Konfiguracja trusted proxy musi byc jawna. Serwer:

- ufa `Forwarded`/`X-Forwarded-*` tylko od skonfigurowanych adresow proxy
- wyznacza canonical resource URI niezaleznie od wewnetrznego hosta kontenera
- nie przyjmuje tozsamosci uzytkownika z niepodpisanych dowolnych naglowkow
- rozroznia edge rate limiting od limitow per subject/tool egzekwowanych w aplikacji
- propaguje request/correlation id bez pozwalania klientowi na podszycie sie pod istniejacy audit event

TLS moze byc zakonczony na gatewayu, jesli polaczenie gateway-serwer znajduje sie w jawnie zdefiniowanej zaufanej sieci lub uzywa mTLS.

### 33.2 OAuth

Dla chronionego Streamable HTTP adapter musi byc zgodny z aktualna specyfikacja authorization MCP:

- Protected Resource Metadata
- discovery authorization servera
- walidacja issuer, audience, expiry i podpisu tokenu
- minimalne scopes i step-up authorization
- zakaz token passthrough
- consent powiazany z uzytkownikiem, klientem i zakresem uprawnien
- osobne credentials lub token exchange dla downstream API

Framework moze integrowac sie z zewnetrznym authorization serverem. Nie implementuje wlasnego pelnego authorization servera w MVP.

### 33.3 Narzedzia wykonujace I/O

Framework dostarcza opcjonalne policies dla:

- ograniczenia filesystem do dozwolonych roots
- ochrony przed path traversal i symlink escape
- allowlist dla outbound HTTP i ochrony SSRF
- limitow odpowiedzi, paginacji i czasu wykonania
- jawnego potwierdzenia operacji destrukcyjnych, jesli klient wspiera elicitation

### 33.4 Twarda walidacja tools

Kazdy tool:

- ma waski input schema z limitem dlugosci stringow, liczby elementow i zakresow liczb
- odrzuca nieznane pola domyslnie, chyba ze kontrakt jawnie je dopuszcza
- waliduje input przed autoryzowana operacja domenowa
- wykonuje autoryzacje capability oraz konkretnego obiektu/tenanta
- ma timeout, limit wspolbieznosci i limit wyniku odpowiednie do operacji
- waliduje structured output wzgledem output schema
- nie zwraca surowych odpowiedzi downstream API bez presentera
- nie przyjmuje dowolnego URL, sciezki pliku, nazwy hosta ani zapytania SQL bez dedykowanej policy

Rate limiting jest dwuwarstwowy:

- gateway chroni endpoint i infrastrukture
- serwer egzekwuje limity per subject, tenant i kosztowny tool

### 33.5 Dlugie operacje i joby

Tool nie utrzymuje wielominutowego requestu lub SSE tylko po to, aby czekac na zakonczenie pracy.

Domyslny wzorzec:

```txt
start-operation -> job/task id
get-operation-status -> pending | running | succeeded | failed | cancelled
get-operation-result -> wynik po zakonczeniu
cancel-operation -> opcjonalne anulowanie
```

Stan joba i wynik sa przechowywane poza procesem workera. Implementacja moze uzyc queue, Redis, PostgreSQL lub dedykowanego job systemu przez porty frameworka.

Gdy stabilna, wspierana wersja MCP Tasks jest dostepna, framework mapuje ten wzorzec na natywne `tasks/get`, `tasks/result` i `tasks/cancel`. Do tego czasu generator moze tworzyc zwykle tools z tym samym modelem domenowym. SSE sluzy dostarczaniu komunikatow i streamingu protokolu, a nie jako jedyny magazyn stanu dlugiej operacji.

## 34. MCP-specific quality rules

Framework ma miec wlasne reguly jakosci MCP:

- `no-console-log-in-stdio`
- `capability-name-valid`
- `capability-name-style-consistent`
- `unique-capability-names`
- `deterministic-registry`
- `mutating-tool-requires-annotations`
- `protected-capability-requires-policy`
- `structured-output-requires-output-schema`
- `no-infrastructure-import-in-mcp`
- `no-sdk-import-in-application`
- `no-sdk-import-in-domain`
- `no-secret-like-output`
- `no-raw-error-stack`
- `no-implicit-any-in-tool-input`
- `no-unbounded-list-tool-without-limit`
- `destructive-tool-requires-destructive-hint`
- `external-side-effect-requires-open-world-hint`

Szczegolnie wazna regula:

```txt
Kazdy tool zwracajacy liste musi miec input limit albo hardcoded max limit.
```

Przyklad:

```ts
inputSchema: z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(50).default(10)
})
```

## 35. Kolejnosc implementacji MVP

### Etap 1: pionowy happy path

Zakres:

- `defineTool`
- `createMcpApp`
- stdio transport
- jawny registry
- przyklad health tool
- minimalny `create-mcp-kit`
- test wywolania toola przez klienta MCP

Kryterium akceptacji:

```txt
Mozna stworzyc serwer MCP przez npm create mcp-kit@latest i odpalic go lokalnie.
Klient MCP wykonuje health tool przez stdio.
```

### Etap 2: komplet podstawowych capabilities

Zakres:

- `defineResource`
- `definePrompt`
- pelny wynik MCP i structured output
- bledy, cancellation, progress i logging
- test client i statyczne assertions
- testy oficjalnego conformance runnera dla wspieranego zakresu

Kryterium akceptacji:

```txt
Wygenerowany serwer przechodzi testy lifecycle, tools, resources i prompts.
```

### Etap 3: CLI i generatory

Zakres:

- `mcp-kit new`
- `mcp-kit init`
- `mcp-kit add`
- `mcp-kit doctor`
- jedna architektura feature-first
- presety jakosci off/standard/strict
- warianty transportu stdio/http/both
- manifest, dry-run i transakcyjny zapis

Kryterium akceptacji:

```txt
Init jest idempotentny i nie uszkadza istniejacego projektu.
```

### Etap 4: quality

Zakres:

- `quality --fast`
- `quality --full`
- ESLint, typecheck, Vitest, Knip
- podstawowe testy architektoniczne w kazdym projekcie
- rozszerzone kontrole dependency-cruiser w presecie strict
- presety coverage
- raport JSON

Kryterium akceptacji:

```txt
quality --full przechodzi w kazdym oficjalnym wariancie template i wykrywa zepsuty kontrakt.
```

### Etap 5: Streamable HTTP i security

Zakres:

- bezpieczny adapter HTTP
- stateless-first i zewnetrzny session store dla stateful mode
- deployment za API gateway/reverse proxy bez przenoszenia zaufania poza serwer
- auth middleware i policy
- OAuth resource server integration
- limity, session lifecycle i graceful shutdown
- twarda walidacja tools
- porty job store/queue i wzorzec dlugich operacji
- testy security cases

Kryterium akceptacji:

```txt
Serwer HTTP przechodzi conformance i negatywne testy auth/session/origin/host.
Wdrozenie wieloreplikowe dziala bez sticky sessions i lokalnego stanu procesu.
```

### Etap 6: release tooling

Zakres:

- `mcp-kit release`
- `quality --release`
- `prepublishOnly`
- GitHub Actions
- package smoke test

Kryterium akceptacji:

```txt
Nie da sie wykonac release bez przejscia quality --release standardowa sciezka.
```

### Etap 7: mutation testing

Zakres:

- StrykerJS config
- `quality --mutation`
- nightly workflow
- optional release enforcement

Kryterium akceptacji:

```txt
Mutation score ponizej threshold konczy pipeline bledem.
```

## 36. Kryteria akceptacji calego projektu

Framework spelnia wymagania, gdy:

- `npm create mcp-kit@latest my-server` dziala
- `mcp-kit init --yes` dziala w istniejacym repo
- wygenerowany projekt uruchamia MCP server przez stdio
- klient MCP moze wykonac tool, odczytac resource i pobrac prompt
- wspierany zakres przechodzi oficjalny MCP conformance runner
- `quality --full` przechodzi w swiezym projekcie
- coverage odpowiada wybranemu presetowi jakosci
- `quality --release` jest wymagany przed release
- pre-commit odpala `quality --fast`
- CI odpala `quality --full`
- mutation testing jest dostepny jako opcja
- testy architektoniczne wykrywaja zle importy we wszystkich projektach
- testy kontraktowe wykrywaja tool bez schema
- integracja z agentami jest opcjonalna i vendor-neutral
- `init` jest idempotentny
- CLI planuje zmiany, uzywa manifestu i nie nadpisuje niezarzadzanych plikow
- framework nie ukrywa oficjalnego MCP SDK tam, gdzie nie trzeba
- stdio nie emituje logow na stdout
- HTTP ma bezpieczne defaults dla host, origin, sessions i auth
- production HTTP jest stateless-first i wspiera zewnetrzne session/job stores
- referencyjny deployment za gatewayem nie omija autoryzacji i limitow serwera
- dlugie operacje sa modelowane jako job/task, a nie wielominutowy request
- framework promuje jeden bounded context na wdrazany serwer MCP
- macierz zgodnosci SDK/protokol/Node jest opublikowana i testowana

## 37. Domyslny happy path

Nowy projekt:

```txt
npm create mcp-kit@latest users-mcp
cd users-mcp
pnpm quality
pnpm dev
```

Istniejace repo:

```txt
pnpm dlx mcp-kit init --yes
pnpm mcp-kit quality --full
```

Dodanie toola:

```txt
pnpm mcp-kit add tool get-user
pnpm mcp-kit quality --full
```

Release:

```txt
pnpm mcp-kit release
```

Tryb agent-friendly, bez zalozenia konkretnego narzedzia:

```txt
pnpm dlx mcp-kit init --yes --agent none
pnpm mcp-kit quality --json
```

Tryb z neutralnymi instrukcjami dla agentow:

```txt
pnpm dlx mcp-kit init --yes --agent generic
```

## 38. Podsumowanie decyzji

Rekomendowany ksztalt projektu:

```txt
mcp-kit-js = progresywny runtime i tooling do budowy poprawnych serwerow MCP
```

Nie:

```txt
mcp-kit-js = ciezki application framework
```

Najwazniejsze zasady:

- `new` tworzy nowy katalog
- `init` inicjalizuje biezacy projekt
- domyslnie nie zakladamy zadnego konkretnego agenta kodujacego
- quality jest pierwszorzednym elementem frameworka
- quality i release sa presetami tooling, nie zaleznosciami runtime
- mutation testing jest opcjonalne
- 100% coverage jest opcja presetu strict, nie uniwersalnym dowodem jakosci
- architektura i kontrakty MCP sa testowane automatycznie
- wszystkie generowane projekty uzywaja jednej architektury feature-first
- produkcyjna topologia to male serwery bounded-context przez Streamable HTTP, stateless-first
- gateway chroni edge, ale serwer zachowuje wlasna walidacje, autoryzacje, limity i audit
- zgodnosc protokolu jest testowana przez rzeczywistego klienta i conformance runner
- bezpieczenstwo HTTP wynika z jawnych granic zaufania i bezpiecznych defaults, nie ze skanowania nazw pol

## 39. Referencje normatywne

Stan odniesienia dla wersji 0.3 dokumentu:

- MCP Specification, rewizja 2025-11-25
- oficjalny Model Context Protocol TypeScript SDK
- oficjalny MCP Conformance Test Suite
- MCP Authorization i Security Best Practices

Implementacja nie kopiuje recznie typow protokolu, jesli moze importowac je z kompatybilnej wersji oficjalnego SDK. Przy rozbieznosci miedzy ta specyfikacja a normatywna specyfikacja MCP pierwszenstwo ma MCP, a rozbieznosc jest traktowana jako bug frameworka.
