export type EssentialSubsection = "large" | "small" | "optional";

export type EssentialItemDefinition = {
  id: string;
  label: string;
  subsection: EssentialSubsection;
  legacyLabels?: string[];
};

export type EssentialCategoryDefinition = {
  id: string;
  title: string;
  icon: string;
  color: string;
  items: EssentialItemDefinition[];
};

const item = (
  id: string,
  label: string,
  subsection: EssentialSubsection,
  legacyLabels?: string[],
): EssentialItemDefinition => ({ id, label, subsection, legacyLabels });

export const ESSENTIAL_SUBSECTION_LABELS: Record<EssentialSubsection, string> = {
  large: "Large Items",
  small: "Small Items",
  optional: "Optional Items",
};

export const ESSENTIAL_CATALOG: EssentialCategoryDefinition[] = [
  {
    id: "room",
    title: "Room & Bedroom",
    icon: "home",
    color: "#7B6252",
    items: [
      item("room-standing-fan", "Standing or box fan", "large", ["Standing Fan / Box Fan"]),
      item("room-rug", "Small rug", "large", ["Small Rug"]),
      item("room-lamp", "Lamp", "small"),
      item("room-mirror", "Mirror", "small"),
      item("room-hangers", "Hangers", "small"),
      item("room-storage-bins", "Under-bed storage bins", "small", ["Plastic Storage Bins (under bed / wardrobe)"]),
      item("room-towel-hook", "Removable towel hook", "small", ["Towel Hook (Command Strip)"]),
      item("room-shower-caddy", "Shower caddy", "small", ["Shower Caddy"]),
      item("room-alarm-clock", "Alarm clock", "optional", ["Alarm Clock"]),
      item("room-decor", "Room décor", "optional", ["Room Decor (string lights, posters, pictures)"]),
      item("room-door-whiteboard", "Door whiteboard", "optional", ["Whiteboard for Door"]),
    ],
  },
  {
    id: "kitchen",
    title: "Kitchen",
    icon: "coffee",
    color: "#A7744D",
    items: [
      // these items are large because often require cleaning of some sort.
      // Mini fridge, microwave, toaster, baking tray, cutting board, dish drying rack, food storage containers
      // these items only reuqire one of each.
      item("kitchen-mini-fridge", "Mini fridge", "large", ["Mini-fridge"]),
      item("kitchen-microwave", "Microwave", "large"),
      item("kitchen-toaster", "Toaster", "large"),
      item("kitchen-baking-tray", "Baking tray", "large", ["Oven Baking Tray"]),
      item("kitchen-cutting-board", "Cutting board", "large", ["Cutting Board"]),
      item("kitchen-drying-rack", "Dish drying rack", "large", ["Dish Drying Rack", "Dish Drying Mat"]),
      item("kitchen-food-storage", "Food storage containers", "large", ["Food Storage Containers", "Tupperware"]),
      item("kitchen-water-filter", "Water filter pitcher", "optional", ["Water Filter / Brita"]),
      item("kitchen-air-fryer", "Air fryer", "optional", ["Air Fryer"]),

      //small items
      // tehse items definittely require multiple of each.
      item("kitchen-pots", "Pots", "small"),
      item("kitchen-pans", "Pans", "small"),
      item("kitchen-knives", "Knives", "small"),
       item("kitchen-plates", "Plates", "small", ["Paper Plates (backup)"]),
      item("kitchen-bowls", "Bowls", "small", ["Microwave-safe Bowls"]),
      item("kitchen-glasses", "Glasses", "small", ["Tumbler"]),
      item("kitchen-mugs", "Mugs", "small", ["Mug"]),
      item("kitchen-cutlery", "Cutlery", "small", ["Silverware / Cutlery", "Silverware", "Reusable Utensil Kit", "Plastic Silverware (backup)"]),
      item("kitchen-cutlery-organizer", "Cutlery organizer", "small", ["Silverware Organizer"]),
      item("kitchen-spice-containers", "Spice containers", "small"),
      item("kitchen-towels", "Kitchen towels", "small", ["Dish Towel", "kitchen towel"]),
      

      // small items
      item("kitchen-scissors", "Kitchen scissors", "small", ["Kitchen Scissors"]),
      item("kitchen-spatulas", "Spatulas", "small"),
      item("kitchen-mixing-spoons", "Mixing spoons", "small", ["Mixing Spoons"]),
      item("kitchen-tongs", "Tongs", "small"),
      item("kitchen-whisk", "Whisk", "small"),
      item("kitchen-peeler", "Peeler", "small"),
      

      // small items
      // legit only need one of each.
      item("kitchen-can-opener", "Can opener", "small", ["Can Opener", "can operner"]),
      item("kitchen-bottle-opener", "Bottle opener", "small", ["Bottle Opener"]),
      item("kitchen-measuring-cups", "Measuring cups", "small", ["Measuring Cups"]),
      item("kitchen-strainer", "Strainer", "small", ["Strainer / Colander", "strainger"]),
      item("kitchen-colander", "Colander", "small"),
      item("kitchen-salt-pepper", "Salt and pepper dispensers", "small", ["salt/pepper dispensers"]),
       item("kitchen-oil-dispenser", "Oil dispenser", "optional", ["Oil Dispenser"]),
      
     
      // small items
      // basically disposable items (will need to be repurchased throughout year)
      item("kitchen-dish-soap", "Dish soap", "small", ["Dish Soap"]),
      item("kitchen-sponges", "Sponges", "small", ["Sponge", "Bottle Brush"]),
      item("kitchen-dishwasher-pods", "Dishwasher detergent/pods", "optional", ["Dishwasher Pods"]),
      item("kitchen-paper-towels", "Paper towels", "small", ["Paper Towels"]),
  
      item("kitchen-trash-can", "Trash can", "small", ["Trash Can"]),
      item("kitchen-trash-bags", "Trash bags", "small", ["Trash Bags", "Plastic Bags"]),
      

      // large items
      // kind of optional I guess? but realistically people downloading the app would have these
      item("kitchen-coffee-maker", "Coffee maker", "optional", ["Coffee Maker"]),
      item("kitchen-electric-kettle", "Electric kettle", "optional", ["Hot Water Kettle", "hot water kettle"]),
      item("kitchen-blender", "Blender", "optional"),
      item("kitchen-rice-cooker", "Rice cooker", "optional", ["Rice Cooker"]),
     
      // Note: can potentially change this label to "extra" later?
    
      item("kitchen-chip-clips", "Chip clips", "optional", ["Chip Clips"]),
      item("kitchen-food-wraps", "Food wraps and foil", "optional", ["Saran Wrap / Cling Film", "Parchment Paper", "Aluminium Foil"]),

      item("kitchen-wine-glasses", "Wine glasses", "optional"),
      item("kitchen-shot-glasses", "Shot glasses", "optional"),
      item("kitchen-metal-straws", "Metal straws", "optional"),
    ],
  },
  {
    id: "cleaning",
    title: "Cleaning Supplies",
    icon: "wind",
    color: "#8A7462",
    items: [
      item("cleaning-vacuum", "Vacuum", "large", ["Mini Vacuum"]),
      item("cleaning-mop", "Mop", "large", ["Swiffer / Mop"]),
      item("cleaning-laundry-basket", "Laundry basket", "large", ["Laundry Basket"]),
      item("cleaning-detergent", "Laundry detergent", "small", ["Laundry Detergent"]),
      item("cleaning-all-purpose", "All-purpose cleaner", "small", ["All-purpose Cleaner"]),
      item("cleaning-disinfectant", "Disinfectant wipes", "small", ["Clorox / Disinfectant Wipes"]),
      item("cleaning-glass", "Glass and mirror cleaner", "small", ["Windex / Glass Cleaner", "Mirror Cleaner"]),
      item("cleaning-toilet", "Toilet cleaner", "small", ["Toilet Cleaner"]),
      item("cleaning-rags", "Cleaning rags", "small", ["Cleaning Rags", "Rag"]),
      item("cleaning-trash-bags", "Trash bags", "small", ["Trash Bags"]),
      item("cleaning-brush", "Scrub brush", "small"),
      item("cleaning-dustpan", "Broom and dustpan", "small"),
      item("cleaning-air-freshener", "Air freshener", "optional", ["Febreze / Air Freshener"]),
    ],
  },
  {
    id: "bedding",
    title: "Bedding & Linens",
    icon: "moon",
    color: "#B1846D",
    items: [
      item("bedding-topper", "Mattress pad or topper", "large", ["Mattress Pad / Topper"]),
      item("bedding-comforter", "Duvet or comforter", "large", ["Duvet / Comforter"]),
      item("bedding-sheets", "Sheets", "small"),
      item("bedding-pillows", "Pillows", "small"),
      item("bedding-pillowcases", "Pillowcases", "small"),
      item("bedding-bath-towels", "Bath towels", "small", ["Bath Towels"]),
      item("bedding-hand-towels", "Hand towels", "small", ["Hand Towels"]),
      item("bedding-washcloths", "Washcloths", "small"),
      item("bedding-throw", "Throw blanket", "optional", ["Throw Blanket"]),
      item("bedding-lint-roller", "Lint roller", "optional", ["Lint Roller"]),
      item("bedding-steamer", "Clothes steamer or iron", "optional", ["Steamer / Iron"]),
    ],
  },
  {
    id: "bathroom",
    title: "Bathroom",
    icon: "droplet",
    color: "#87644B",
    items: [
      item("bathroom-trash-can", "Bathroom trash can", "large", ["Trashcan"]),
      item("bathroom-toilet-paper", "Toilet paper", "small", ["Toilet Paper"]),
      item("bathroom-hand-soap", "Hand soap", "small", ["Hand Soap", "Hand Soap Refills"]),
      item("bathroom-caddy", "Shower caddy", "small", ["Shower Toiletries Holder / Caddy"]),
      item("bathroom-hand-towels", "Hand towels", "small", ["Hand Towels"]),
      item("bathroom-toilet-cleaner", "Toilet cleaner", "small", ["Toilet Cleaner"]),
      item("bathroom-mirror-cleaner", "Mirror cleaner", "small", ["Mirror Cleaner"]),
      item("bathroom-plunger", "Toilet plunger", "small"),
      item("bathroom-air-freshener", "Air freshener", "optional", ["Febreze"]),
    ],
  },
  {
    id: "utility",
    title: "Utility & Misc",
    icon: "tool",
    color: "#C19362",
    items: [
      item("utility-lockbox", "Lockbox", "large", ["Lock or Lockbox"]),
      item("utility-batteries", "Batteries", "small"),
      item("utility-extension-cord", "Extension cord", "small", ["Extension Cord"]),
      item("utility-power-strip", "Surge-protected power strip", "small", ["Power Strip"]),
      item("utility-duct-tape", "Duct tape", "small", ["Duct Tape"]),
      item("utility-painters-tape", "Painter’s tape", "small", ["Painters Tape"]),
      item("utility-scissors", "Scissors", "small"),
      item("utility-tissues", "Tissues", "small"),
      item("utility-first-aid", "First-aid kit", "small"),
      item("utility-flashlight", "Flashlight", "small"),
      item("utility-calendar", "Wall calendar", "optional", ["Calendar"]),
      item("utility-drawer-organizers", "Drawer organizers", "optional", ["Desk Drawer Organizers"]),
      item("utility-lighter", "Lighter", "optional"),
      item("utility-rag", "Utility rag", "optional", ["Rag"]),
      item("utility-lint-roller", "Lint roller", "optional", ["Lint Roller"]),
      item("utility-steamer", "Clothes steamer or iron", "optional", ["Steamer / Iron"]),
    ],
  },
  {
    id: "food",
    title: "Food Staples",
    icon: "shopping-bag",
    color: "#955C48",
    items: [
      item("food-rice", "Rice", "small"),
      item("food-pasta", "Pasta", "small"),
      item("food-bread", "Bread", "small"),
      item("food-cereal", "Cereal", "small"),
      item("food-oatmeal", "Oatmeal", "small", ["Instant Oatmeal"]),
      item("food-ramen", "Ramen", "small"),
      item("food-tomato-sauce", "Tomato sauce", "small", ["Tomato Sauce"]),
      item("food-soup", "Canned soup", "small", ["Soup (canned)"]),
      item("food-dahl", "Dahl", "small"),
      item("food-tofu", "Tofu", "small"),
      item("food-frozen-vegetables", "Frozen vegetables", "small", ["Frozen Veggies"]),
      item("food-milk", "Milk", "small"),
      item("food-butter", "Butter", "small"),
      item("food-eggs", "Eggs", "small"),
      item("food-yogurt", "Yogurt", "small"),
      item("food-salt", "Salt", "small"),
      item("food-pepper", "Pepper", "small"),
      item("food-sugar", "Sugar", "small"),
      item("food-oil", "Cooking oil", "small", ["Oil"]),
      item("food-garlic", "Garlic", "small"),
      item("food-ginger", "Ginger", "small"),
      item("food-peanut-butter", "Peanut butter", "optional", ["Peanut Butter"]),
      item("food-nutella", "Chocolate-hazelnut spread", "optional", ["Nutella"]),
      item("food-jam", "Jam", "optional"),
      item("food-honey", "Honey", "optional"),
      item("food-soy-sauce", "Soy sauce", "optional", ["Soy Sauce"]),
      item("food-hot-sauce", "Hot sauce", "optional", ["Hot Sauce"]),
      item("food-ketchup", "Ketchup", "optional"),
      item("food-garlic-powder", "Garlic powder", "optional", ["Garlic Powder"]),
      item("food-cinnamon", "Cinnamon", "optional"),
      item("food-chilli-flakes", "Chilli flakes", "optional", ["Chilli Flakes"]),
      item("food-snacks", "Chips, crackers, or cookies", "optional", ["Chips / Crackers / Cookies"]),
      item("food-granola-bars", "Granola bars", "optional", ["Granola Bars"]),
      item("food-popcorn", "Microwave popcorn", "optional", ["Microwave Popcorn"]),
      item("food-tea", "Tea", "optional"),
      item("food-hot-chocolate", "Hot chocolate", "optional", ["Hot Chocolate"]),
      item("food-coffee-pods", "Coffee pods", "optional", ["Coffee Pods"]),
    ],
  },
];

const itemById = new Map(
  ESSENTIAL_CATALOG.flatMap((category) => category.items.map((entry) => [entry.id, entry] as const)),
);
const idByLegacyLabel = new Map<string, string>();
const idByCategoryAndLegacyLabel = new Map<string, string>();
for (const category of ESSENTIAL_CATALOG) {
  for (const entry of category.items) {
    idByLegacyLabel.set(entry.label.toLowerCase(), entry.id);
    idByCategoryAndLegacyLabel.set(`${category.id}:${entry.label.toLowerCase()}`, entry.id);
    for (const alias of entry.legacyLabels ?? []) {
      idByLegacyLabel.set(alias.toLowerCase(), entry.id);
      idByCategoryAndLegacyLabel.set(`${category.id}:${alias.toLowerCase()}`, entry.id);
    }
  }
}

export function essentialItemById(id: string) {
  return itemById.get(id);
}

export function essentialIdForLegacyValue(value: string, categoryId?: string) {
  if (itemById.has(value)) return value;
  return (
    (categoryId
      ? idByCategoryAndLegacyLabel.get(`${categoryId}:${value.toLowerCase()}`)
      : undefined) ??
    idByLegacyLabel.get(value.toLowerCase()) ??
    value
  );
}

export function migrateEssentialRecord<T>(
  record: Record<string, Record<string, T>> | undefined,
): Record<string, Record<string, T>> {
  const migrated: Record<string, Record<string, T>> = {};
  for (const [categoryId, entries] of Object.entries(record ?? {})) {
    const next: Record<string, T> = {};
    for (const [legacyId, value] of Object.entries(entries)) {
      next[essentialIdForLegacyValue(legacyId, categoryId)] = value;
    }
    migrated[categoryId] = next;
  }
  return migrated;
}
