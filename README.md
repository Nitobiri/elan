# Élan

Petite application web personnelle pour suivre ma pesée du matin : poids, composition
corporelle (masse grasse, eau, muscle, os), sport, calories, compléments et objectifs.

- **Type** : application web (PWA) — s'ajoute à l'écran d'accueil de l'iPhone
- **Données** : stockées localement sur l'appareil (privées), avec sauvegarde et
  synchronisation optionnelle vers un Gist GitHub secret
- **Hébergement** : GitHub Pages (gratuit)

## En ligne

Une fois GitHub Pages activé, l'application est accessible ici :
`https://nitobiri.github.io/elan/`

## Ce que fait l'application

- **Pesée du matin** en quelques secondes : chaque métrique se saisit **au choix en % ou en kg**,
  l'autre valeur se calcule en direct. Tous les champs sont facultatifs, les jours sautés sont gérés.
- **Accueil motivant** : ai-je pesé aujourd'hui, poids perdu, masse grasse perdue, IMC,
  progression vers l'objectif, date estimée d'arrivée, paliers franchis, pourquoi je fais ça.
- **Courbes** : évolution en % **et** en kg, moyenne mobile 7 jours, ligne d'objectif, sport, calories.
- **Tableau** : toutes les pesées, colonne % et colonne kg, deltas, export CSV.
- **Sport** : séances, durées, calendrier d'assiduité, totaux semaine / mois / année, séances prévues.
- **Pilulier** : compléments et médicaments, y compris les prises relatives (« 30 min après la séance »).
- **Analyse** : lien entre les calories mangées et le poids, avec décalage de quelques jours.

Aucune donnée personnelle n'est présente dans ce dépôt : il ne contient que le code.
