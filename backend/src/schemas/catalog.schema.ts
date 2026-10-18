export type CatalogEntry = {
  categoryId: number; productId: number; variantId: number; name: string; category: string;
  spec: string; displayName: string; productCode: string | null; aliases: string[]; sourcePages: number[]; sourceFiles: string[];
  verificationStatus: "verified" | "needs_review" | "unreadable";
};

export type CatalogPrice = {
  id: number; priceId: number; categoryId: number; productId: number; variantId: number;
  packagingId: number; name: string; category: string; variantDisplayName: string;
  spec: string; variantSpec: string; packageName: string; packageQuantity: number;
  packageNote: string; priceType: string; minimumQuantity: number; price: number;
  isDemo: boolean; purchasable: boolean;
  unit: string; supplier: string; sourcePages: number[]; sourceFiles: string[]; validFrom: string; validTo: string | null;
  status: "verified" | "needs_review" | "unreadable"; version: number;
};

export type CatalogResponse = { entries: CatalogEntry[]; prices: CatalogPrice[]; syncedAt: string };
