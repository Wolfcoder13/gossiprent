import type { MetadataRoute } from "next";

/**
 * Keep crawlers off pages about private people and pages that are only for
 * the visitor: renters' profiles (/renters and /renters/…), search results,
 * the review wizard, the dashboard and the report form. Landlord profiles
 * without an account also say noindex on the page itself.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/renters", "/search", "/reviews", "/dashboard", "/report"],
    },
  };
}
