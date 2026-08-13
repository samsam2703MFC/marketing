/**
 * Photographie l'application réellement déployée.
 *
 * L'environnement de développement n'a aucune route vers le serveur : sa
 * politique de sortie réseau refuse l'hôte, et toute vérification visuelle s'y
 * arrête sur « je ne peux pas regarder ». Le runner GitHub, lui, y accède déjà
 * — c'est par lui que passe le déploiement. Il prend donc les captures, et les
 * dépose sur une branche que n'importe qui peut récupérer d'un `git fetch`.
 *
 * Le script ne fait échouer le travail que si la page d'accueil ne répond pas.
 * Une étape d'assistant introuvable produit une note dans le journal, pas une
 * erreur : les données du serveur ne sont pas les nôtres, une campagne peut
 * très bien ne pas exister, et une capture manquante reste plus utile qu'un
 * travail rouge sans aucune capture.
 *
 * Usage : node capture-deploiement.mjs <base-url> <dossier-de-sortie>
 */

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = (process.argv[2] ?? '').replace(/\/+$/, '')
const sortie = process.argv[3] ?? 'captures'

if (base === '') {
  console.error('Adresse manquante : node capture-deploiement.mjs <base-url> <dossier>')
  process.exit(2)
}

const journal = []
const note = (texte) => {
  console.log(texte)
  journal.push(texte)
}

await mkdir(sortie, { recursive: true })

const navigateur = await chromium.launch()
const contexte = await navigateur.newContext({
  viewport: { width: 1600, height: 1100 },
  deviceScaleFactor: 1.5,
  locale: 'fr-BE',
})
const page = await contexte.newPage()

page.on('pageerror', (erreur) => note(`  erreur JS : ${String(erreur).slice(0, 200)}`))
page.on('response', (reponse) => {
  if (reponse.status() >= 400 && reponse.url().includes('/api/')) {
    note(`  ${reponse.status()} sur ${reponse.url().replace(base, '')}`)
  }
})

const photographier = async (nom) => {
  const fichier = path.join(sortie, `${nom}.png`)
  await page.screenshot({ path: fichier, fullPage: false })
  note(`  → ${nom}.png`)
}

/** Clic tolérant : le serveur n'a pas nos données, une cible peut manquer. */
const cliquer = async (cible, libelle) => {
  try {
    await cible.first().click({ timeout: 8000 })
    await page.waitForTimeout(1800)

    return true
  } catch {
    note(`  « ${libelle} » introuvable — capture prise en l'état`)

    return false
  }
}

// 1 — La page d'accueil. C'est la seule dont l'absence est une vraie panne.
//     Un serveur injoignable doit se lire en une ligne : une trace de pile
//     Playwright dans un journal de workflow envoie chercher le défaut du
//     mauvais côté.
let reponse
try {
  reponse = await page.goto(`${base}/?brand=1`, { waitUntil: 'networkidle', timeout: 45_000 })
} catch (echec) {
  note(`accueil : injoignable — ${String(echec).split('\n')[0]}`)
  await navigateur.close()
  process.exit(1)
}

note(`accueil : HTTP ${reponse?.status() ?? '—'} · ${await page.title()}`)

if ((reponse?.status() ?? 500) >= 400) {
  await photographier('00-accueil')
  await navigateur.close()
  console.error('La page déployée ne répond pas.')
  process.exit(1)
}

await page.waitForTimeout(2500)
await photographier('00-accueil')

// 2 — La liste des campagnes.
if (await cliquer(page.getByRole('link', { name: 'Campagnes', exact: true }), 'Campagnes')) {
  await photographier('01-campagnes')
}

// 3 — L'assistant, si une campagne est reprenable. Les étapes qui nous
//     intéressent sont celles qu'on vient de changer.
const repris = await cliquer(page.getByText('Reprendre là où vous en étiez'), 'Reprendre')

if (repris) {
  await page.waitForTimeout(1500)
  await photographier('02-assistant')

  for (const [nom, motif] of [
    ['03-objectifs', /Objectifs de vente$/],
    ['04-prix', /Prix$/],
  ]) {
    if (await cliquer(page.getByRole('button', { name: motif }), String(motif))) {
      // La période d'analyse par défaut est le mois en cours : sans ventes
      // dessus, l'écran est vide et ne montre rien de ce qu'on veut voir.
      await cliquer(page.getByRole('button', { name: '12 derniers mois' }), '12 derniers mois')
      await page.waitForTimeout(2500)
      await photographier(nom)
    }
  }
}

await writeFile(path.join(sortie, 'journal.txt'), `${journal.join('\n')}\n`, 'utf8')
await navigateur.close()
