# Git add — guide des options

---

## 1. Ajouter tout un dossier (inclut tous les sous-dossiers)

```bash
git add backend-nest/src/modules/admin-certificates/
git commit -m "feat(admin-certificates): add staff review endpoints"
```

Le `/` final inclut automatiquement tout le contenu récursif.

---

## 2. Ajouter plusieurs dossiers ou fichiers en une ligne

```bash
git add CLAUDE.md .claude/
git commit -m "chore(claude): add workflow guide and subagent definitions"
```

---

## 3. Ajouter un dossier en excluant un fichier précis

```bash
git add .claude/ -- ':!.claude/scheduled_tasks.lock'
git commit -m "chore(claude): add workflow guide and subagent definitions"
```

Le `:!` signifie "exclure ce chemin".

---

## 4. Ajouter un dossier en excluant un type de fichier

```bash
git add backend-nest/ -- ':!**/*.spec.ts'
git commit -m "feat(bitnob): add payout quote endpoint"
```

`**/*.spec.ts` exclut tous les fichiers `.spec.ts` dans n'importe quel sous-dossier.

---

## 5. Plusieurs exclusions à la fois

```bash
git add frontmobile/ -- ':!frontmobile/pnpm-lock.yaml' ':!**/*.log' ':!**/*.spec.ts'
git commit -m "feat(mobile/admin): add admin dashboard screens"
```

Chaque exclusion est un argument séparé avec son propre `:!`.

---

## 6. Exclusion permanente via `.gitignore`

Si tu ne veux **jamais** committer un fichier ou type de fichier, ajoute-le dans `.gitignore` :

```
# .gitignore
.claude/scheduled_tasks.lock
**/*.log
*.env.local
```

Après ça, `git add .claude/` ou même `git add .` ne l'inclura plus jamais.

---

## Tableau récapitulatif

| Besoin | Commande |
|---|---|
| Tout un dossier | `git add backend-nest/src/modules/admin-certificates/` |
| Plusieurs cibles | `git add CLAUDE.md .claude/` |
| Dossier sauf un fichier | `git add .claude/ -- ':!.claude/scheduled_tasks.lock'` |
| Dossier sauf un type | `git add backend-nest/ -- ':!**/*.spec.ts'` |
| Dossier sauf plusieurs | `git add frontmobile/ -- ':!pnpm-lock.yaml' ':!**/*.log'` |
| Exclusion permanente | ajouter dans `.gitignore` |

---

## Règles à ne jamais enfreindre

- Ne jamais utiliser `git add .` — inclut tout sans contrôle
- Ne jamais utiliser `git add -A` — même problème
- Préférer `git add dossier/` à lister les fichiers un par un
- Si un fichier ne doit jamais être commité → `.gitignore`, pas une exclusion manuelle à chaque fois
