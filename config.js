/* Buck Ledger settings: the only file you need to edit to launch paid tiers.
 *
 * TIERS (all one-time purchases on Gumroad, no subscription):
 *   Free  : FREE_CAMERA_LIMIT cameras, FREE_BUCK_LIMIT named bucks, FREE_PRED_LIMIT prediction (+ its scored result)
 *   Pro   : PRO_CAMERA_LIMIT cameras, PRO_BUCK_LIMIT named bucks, PRO_OPEN_PRED_LIMIT open predictions at a time  (PRO_PRICE)
 *   Elite : unlimited cameras, bucks + predictions, plus the 3D Terrain Sim     (ELITE_PRICE)
 *   Every tier: state rut/acorn research, sun + moon per visit, weather per visit, ribbon temp, headings, bait log,
 *               points + small-buck filter, rename history, profile photo, companions, buck ID suggestions, 3D demo.
 *   Elite Upgrade : Pro owners pay the difference (UPGRADE_PRICE). Its key only unlocks Elite on a phone
 *                   that already holds a valid Pro key; both keys are re-checked with Gumroad.
 *
 * Option A is live: product 4n-1sk-GKau8qkWiclOoIQ== (mfuuir). Option B ids stay empty.
 *   While empty, the app runs in Free mode and no buy buttons are shown. Nothing breaks.
 *
 * OPTION A (recommended): ONE Gumroad product with three versions named exactly
 *   "Pro" ($30), "Elite" ($50), "Elite Upgrade" ($20), with "Generate a unique license key per sale" on.
 *   Paste its product_id into GUMROAD_PRODUCT_ID and its link into CHECKOUT_URL.
 *   The app reads the version from Gumroad's verify reply (purchase.variants).
 * OPTION B (fallback): three separate products. Fill PRO_/ELITE_/UPGRADE_PRODUCT_ID and the matching
 *   *_CHECKOUT_URL instead (leave GUMROAD_PRODUCT_ID empty).
 * After editing: bump VERSION in sw.js and publish.
 *
 * License keys are verified ONCE online with Gumroad, then keep working on the phone. Refunded / charged-back /
 *   disabled keys are refused, and (when online) re-checked every RECHECK_DAYS.
 * DEV_MODE: keep false in production. When true, the code BUCKLEDGER-TEST unlocks Elite for testing.
 */
window.BUCKLEDGER_CONFIG = {
  APP_NAME: "Buck Ledger",
  PRO_PRICE: "$30",
  ELITE_PRICE: "$50",
  UPGRADE_PRICE: "$20",
  PRO_PRICE_NOTE: "One-time purchase. No subscription.",

  // Option A: one product with versions "Pro", "Elite", "Elite Upgrade"
  GUMROAD_PRODUCT_ID: "4n-1sk-GKau8qkWiclOoIQ==", // Buck Ledger (permalink mfuuir), confirmed on the live Gumroad page
  CHECKOUT_URL: "https://sladepatterson.gumroad.com/l/mfuuir",

  // Option B (fallback): separate products. Leave empty if you use Option A.
  PRO_PRODUCT_ID: "",            // <<< not set
  ELITE_PRODUCT_ID: "",          // <<< not set
  UPGRADE_PRODUCT_ID: "",        // <<< not set
  PRO_CHECKOUT_URL: "https://sladepatterson.gumroad.com/l/mfuuir?option=I6o9eu1FCWosy08bqXWHMw%3D%3D",     // preselects version "Pro"
  ELITE_CHECKOUT_URL: "https://sladepatterson.gumroad.com/l/mfuuir?option=Nvn3BmaqeQ7cwvslu8_YWQ%3D%3D",   // preselects version "Elite"
  UPGRADE_CHECKOUT_URL: "https://sladepatterson.gumroad.com/l/mfuuir?option=GUKWGkahR2DNUluPySooYg%3D%3D", // preselects version "Elite Upgrade"

  LICENSE_VERIFY_URL: "https://api.gumroad.com/v2/licenses/verify", // Gumroad allows browser (CORS) calls
  MAX_ACTIVATIONS: 5,
  RECHECK_DAYS: 30,
  FREE_CAMERA_LIMIT: 1,          // confirmed by Slade
  FREE_BUCK_LIMIT: 1,            // confirmed by Slade
  PRO_CAMERA_LIMIT: 3,           // confirmed by Slade
  PRO_BUCK_LIMIT: 3,             // confirmed by Slade
  FREE_PRED_LIMIT: 1,            // Slade: Free = ONE prediction + ONE scored result
  PRO_OPEN_PRED_LIMIT: 3,        // Set by Slade (Oct 12): Pro = up to 3 open (unscored) predictions at a time; scored ones don't count

  DEV_MODE: false,
  DEV_UNLOCK_CODE_SHA256: [
    "3a54c6c7e655155426c791d8e7fe1255f1d3241247f96e7754aea9d0109608e0" // BUCKLEDGER-TEST (only works when DEV_MODE is true)
  ]
};
