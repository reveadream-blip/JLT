/**
 * Ajoute tout, commit (si changements) et push vers origin.
 * Usage:
 *   npm run git:sync
 *   npm run git:sync -- "fix: correction du formulaire"
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { exit } from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cwd = join(__dirname, '..')

const msg =
  process.argv.slice(2).join(' ').trim() ||
  `chore: sync ${new Date().toISOString().slice(0, 10)}`

execSync('git add -A', { stdio: 'inherit', cwd })

const porcelain = execSync('git status --porcelain', { encoding: 'utf8', cwd })
if (!porcelain.trim()) {
  console.log('[git:sync] Rien à committer.')
  exit(0)
}

execSync(`git commit -m ${JSON.stringify(msg)}`, { stdio: 'inherit', cwd })

const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd }).trim()
execSync(`git push -u origin ${branch}`, { stdio: 'inherit', cwd })
