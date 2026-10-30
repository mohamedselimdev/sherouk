import { createDb } from "../../server/db";
import { listStoreProducts } from "../../server/catalog/store";

const DEV_URL = "postgres://shrouk:shrouk_local_only@127.0.0.1:54329/shrouk_dev";

/** Demo-cart localStorage payload (see app/lib/cart.tsx) built from real seeded variants. */
export async function demoCart(slugs: string[], qty = 1) {
  const { db, close } = createDb(DEV_URL, 1);
  try {
    const products = await listStoreProducts(db);
    return slugs.flatMap((slug) => {
      const p = products.find((x) => x.slug.en === slug);
      const c = p?.colors[0];
      if (!p || !c) throw new Error(`seed product ${slug} missing (run npm run db:seed)`);
      return [
        {
          variantId: c.variantId,
          slug: p.slug,
          name: p.name,
          image: p.image,
          colorKey: c.colorKey,
          price: c.price,
          qty,
        },
      ];
    });
  } finally {
    await close();
  }
}
