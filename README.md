# Captures de l'application déployée

Images produites par `.github/workflows/captures.yml`, prises depuis un runner
GitHub sur le serveur réel. Elles vivent sur la branche `captures` parce que
l'environnement de développement n'a pas de route réseau vers cet hôte et ne
peut donc pas les prendre lui-même.

Ce ne sont que des observations : rien ici n'est du code, et cette branche n'a
pas vocation à être fusionnée.

```bash
git fetch origin captures
git show origin/captures:00-accueil.png > accueil.png
```

`journal.txt` dit ce que la session a rencontré — étapes atteintes, erreurs
d'API, éléments introuvables. Une capture manquante y est expliquée plutôt que
silencieuse.
