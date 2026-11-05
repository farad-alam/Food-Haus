// The 14 allergens that UK food law requires businesses to declare (FSA).
// Keys are what is stored in item.allergens; labels are what people read.
export const ALLERGENS = [
  { key: "celery", label: "Celery" },
  { key: "gluten", label: "Cereals containing gluten" },
  { key: "crustaceans", label: "Crustaceans" },
  { key: "eggs", label: "Eggs" },
  { key: "fish", label: "Fish" },
  { key: "lupin", label: "Lupin" },
  { key: "milk", label: "Milk" },
  { key: "molluscs", label: "Molluscs" },
  { key: "mustard", label: "Mustard" },
  { key: "nuts", label: "Tree nuts" },
  { key: "peanuts", label: "Peanuts" },
  { key: "sesame", label: "Sesame" },
  { key: "soya", label: "Soya" },
  { key: "sulphites", label: "Sulphur dioxide / sulphites" },
] as const;
export const ALLERGEN_KEYS = ALLERGENS.map((a) => a.key) as [string, ...string[]];

// Deliberately small. Halal is shop-wide (print menu). Anything that is a
// safety claim (e.g. "gluten free") is NOT offered as a tag: use the allergens.
export const DIETARY_TAGS = [
  { key: "vegetarian", label: "Vegetarian" },
  { key: "vegan", label: "Vegan" },
  { key: "spicy", label: "Spicy" },
] as const;
export const DIETARY_KEYS = DIETARY_TAGS.map((t) => t.key) as [string, ...string[]];
