# Shop Santé — Réappro Metro

Application privée pour la **commande hebdomadaire de chaque Metro**.

1. **Ventes** : importez les fichiers de ventes des Metros (Excel ou CSV), avec une ligne par Metro, produit et date. Les colonnes sont reconnues par leur nom : Magasin/Metro, SKU/UPC, Qté vendue, Date/Semaine, et en option Inventaire et Format caisse. Chaque fichier remplace les semaines qu’il couvre. Les 26 dernières semaines sont conservées.
2. **Règle** (celle de l’outil de réappro de Vanier) :
   - rythme des 4 dernières semaines ;
   - tendance ±15 % (au-dessus de 1,3× ou sous 0,7× le rythme des 12 semaines) ;
   - si le stock est connu : couverture + délai × sécurité − stock. Sinon, on remplace ce qui s’est vendu ;
   - arrondi à la caisse supérieure.
3. **Jev** (TypeSafe, via Netlify AI Gateway) : pour chaque ligne, il choisit entre *rien*, *une caisse de moins*, *la règle* et *une caisse de plus*, et donne la probabilité de chaque option. Une confiance sous 60 % marque la ligne « à vérifier ». Si Jev ne répond pas, la règle s’applique.
4. **Validation** : les quantités sont modifiables. La commande est enregistrée par semaine et se télécharge en CSV, un fichier par Metro.

Ne jamais ajouter au dépôt de données de ventes réelles, de jeton ou de mot de passe.

## Hébergement Netlify

- **Construction** : Next.js (`netlify.toml`), Node 22.
- **Base de données** : Netlify Database (PostgreSQL), créée par le paquet `@netlify/database`. Les migrations sont dans `netlify/database/migrations/`.
- **Connexion** : un seul propriétaire, avec la variable secrète `APP_PASSWORD` (12 caractères minimum). Le cookie de session est signé avec une clé dérivée du mot de passe.
- **Jev** : il faut activer l’AI Gateway sur le site. Netlify fournit les accès aux fonctions, sans clé à saisir; les appels sont facturés en crédits Netlify. Les requêtes partent de `app/api/metro/route.js`, par lots de 20 lignes.

## Développement

```bash
npm ci
npm test            # lecture des fichiers, règle, Jev simulé, connexion — PostgreSQL en mémoire (PGlite)
npm run typecheck
npm run build
```

Les données des tests sont fictives.
