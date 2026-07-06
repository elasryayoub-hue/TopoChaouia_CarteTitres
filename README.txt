TopoChaouia — Carte des Titres (application terrain)
======================================================

CE QUE FAIT L'APPLICATION
--------------------------
- Affiche vos parcelles (titres fonciers) en polygones sur un fond de
  carte SATELLITE (Esri World Imagery), directement dans le navigateur.
- Affiche aussi les BORNES (points) reconstituées depuis les colonnes
  X/Y du fichier Bornes.DAT (le fichier Bornes.MAP fourni était
  partiellement corrompu — voir "NOTE TECHNIQUE" plus bas — donc les
  bornes sont recalculées à partir de leurs coordonnées Lambert Maroc).
- Bouton "📍" en bas à droite : active le GPS du téléphone et affiche
  votre position en direct (point bleu) par rapport aux limites des
  parcelles.
- Recherche par N° de titre en haut de l'écran.
- Menu "☰" : afficher/masquer les calques, changer de fond de carte
  (Satellite / Plan).
- Clic sur une parcelle ou une borne : fiche d'information (surface,
  nature, indice, etc.).

DONNÉES CONVERTIES
--------------------------
- Source : titres.TAB/.DAT/.MAP/.ID (projection Lambert Maroc /
  Merchich) → converties en WGS84 (lat/lon) avec GDAL.
- 89 603 parcelles valides converties en polygones (633 lignes ont été
  écartées : géométrie absente ou hors du territoire marocain — à
  vérifier si besoin).
- Découpées en 766 petites tuiles géographiques (dossier tiles/) pour
  que le téléphone ne charge que les parcelles proches de la zone
  affichée à l'écran — sinon un fichier unique de 90 000 parcelles
  serait trop lourd à charger sur mobile.
- Les titres ne s'affichent qu'à partir du zoom 14 (assez proche) pour
  éviter de charger des centaines de tuiles quand la carte est
  dézoomée. Un message en bas du menu indique le zoom actuel.
- 13 347 bornes converties en points.

MISE À JOUR (correctif affichage des titres)
--------------------------
Si les titres ne s'affichaient pas du tout, même en zoomant à fond, la
cause la plus probable est la suivante : ouvrir index.html en
double-cliquant dessus (file://) empêche le navigateur de charger les
fichiers de données locaux (tiles_index.json, les tuiles, les bornes)
par sécurité — alors que le fond satellite continue de s'afficher
normalement car il vient d'internet. L'app affiche maintenant un
message rouge explicite en haut de l'écran si c'est le cas, avec la
marche à suivre (Live Server dans VS Code, ou GitHub Pages).

Autre correctif : la vue de départ se centre maintenant sur le "noyau"
réel de vos données (99% des parcelles, autour de Berrechid/
Casablanca) plutôt que sur l'étendue brute — quelques titres isolés
très loin faisaient dézoomer la carte jusqu'à voir tout le Maroc. Le
seuil de zoom d'affichage des titres est aussi passé de 14 à 13, et un
bandeau orange en bas de l'écran indique désormais clairement quand
zoomer davantage. Un bouton 🗺️ (à côté du bouton GPS) permet de voir
d'un coup toute la zone couverte par vos données, y compris les titres
isolés loin du noyau principal.

COMMENT L'OUVRIR
--------------------------
IMPORTANT : la géolocalisation (bouton 📍) ne fonctionne QUE si le
site est servi en HTTPS ou en local (localhost). Ouvrir index.html
directement en double-cliquant (file://) affichera la carte mais le
GPS sera bloqué par le téléphone/navigateur.

Option A — le plus simple pour le terrain (recommandé) :
  1. Créez un dépôt GitHub (comme pour votre app PointsTopo) et
     déposez-y TOUT le contenu de ce dossier (index.html, style.css,
     app.js, tiles/, tiles_index.json, bornes_clean.geojson,
     search_index.json).
  2. Activez GitHub Pages sur ce dépôt.
  3. Ouvrez l'URL https://votrecompte.github.io/nom-du-depot/ sur
     votre téléphone → tout fonctionne, y compris le GPS (HTTPS).
  4. Vous pouvez l'ajouter à l'écran d'accueil (Chrome → "Ajouter à
     l'écran d'accueil") comme pour PointsTopo.

Option B — test rapide sur PC (Visual Studio Code) :
  1. Ouvrez le dossier dans VS Code.
  2. Installez l'extension "Live Server".
  3. Clic droit sur index.html → "Open with Live Server".
  4. La carte s'ouvre sur http://127.0.0.1:5500/ (le GPS fonctionnera
     aussi ici car localhost est autorisé).

NOTE TECHNIQUE — fichier Bornes.MAP
--------------------------
GDAL a signalé une incohérence entre Bornes.ID et Bornes.MAP
("Object ID from the .ID file differs from the value in the .MAP
file"). Résultat : la géométrie native n'a pas pu être lue depuis le
.MAP. J'ai contourné le problème en reconstruisant les points
directement à partir des champs X/Y stockés dans Bornes.DAT (avec la
même projection Lambert Maroc/Merchich que titres.TAB), ce qui a
fonctionné pour les 13 347 bornes. Si un jour vous rouvrez ce fichier
dans MapInfo et qu'il affiche une erreur similaire, un "Pack" ou une
réparation de la table dans MapInfo réglera probablement la source du
problème côté MapInfo lui-même.

LIMITES CONNUES / AMÉLIORATIONS POSSIBLES
--------------------------
- Pas de mode hors-ligne pour l'imagerie satellite (nécessite internet
  ou une connexion 4G sur le terrain). Les données de parcelles/bornes
  elles, une fois chargées, restent en mémoire pendant la session.
- La recherche charge un index de ~13 Mo au premier usage (une seule
  fois par session).
- Si vous voulez plus tard : mode hors-ligne complet (cache des tuiles
  satellite), mesure de distance sur la carte, export d'une parcelle
  en PDF, ou lien direct entre une parcelle et son dossier Reverse
  Cheminement — tout cela peut être ajouté par-dessus cette base.
