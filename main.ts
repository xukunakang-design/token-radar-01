// token-radar-01: the entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot (from --input <snapshot.json|directory>, default
// /input/snapshot.json), scores every pre-token protocol with the radar-2
// model in lib/model.ts, and writes the ranked board, the dashboard's data,
// the dashboard itself, the screenshots and the judge's dossier into the
// output directory (default /output, or $MAKEFUN_OUTPUT_DIR outside the
// grader's container).
//
// The dashboard is a static page with no framework and no network calls:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read the
// data.js this program writes from the same board, so the page, the board
// and the dossier can never disagree about a number.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleRadar, boardProblem, dataJs, readSnapshot } from './lib/model.ts'
import { buildDossier } from './vendor/makefun-board.ts'

const here = fileURLToPath(new URL('.', import.meta.url))

/** The gate's caps for the dossier this program writes. */
const TEXT_CAP_BYTES = 65_536
const SHOT_CAP = { max: 4, max_bytes: 524_288 }
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/

/** The value after --name <value> (or --name=<value>), or the fallback when the flag is absent. */
function flagValue(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`))
  return joined === undefined ? fallback : joined.slice(name.length + 3)
}

const inputGiven = flagValue('input', '/input')
const inputFile = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json')
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`)
  process.exit(2)
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output')

const snapshot = readSnapshot(readFileSync(inputFile, 'utf8'))
const { board, radar } = assembleRadar(snapshot)
const problem = boardProblem(board, snapshot)
if (problem !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${problem}\n`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`)
writeFileSync(join(outDir, 'data.js'), dataJs(radar))

/** One directory's regular files copied into `to`, skipping dotfiles; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return []
  mkdirSync(to, { recursive: true })
  const copied: string[] = []
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue
    const path = join(from, name)
    if (!statSync(path).isFile()) continue
    copyFileSync(path, join(to, name))
    copied.push(name)
  }
  return copied
}

copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'))
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'))
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`)
  process.exit(1)
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`)
    process.exit(1)
  }
}

// The dossier goes last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: TEXT_CAP_BYTES, screenshots: SHOT_CAP, dashboard: { max_files: 400, max_bytes: 4_194_304 } }))

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
)
