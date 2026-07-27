/** Initial Amazon KDP Adult Coloring Books wiki hierarchy (plan §11.2). */

export interface WikiHierarchyNode {
  slug: string;
  title: string;
  /** Leaf topic key used to route memory into this page. */
  topicKey?: string;
  children?: WikiHierarchyNode[];
}

export const AMAZON_KDP_COLORING_HIERARCHY: WikiHierarchyNode = {
  slug: "amazon-us",
  title: "Amazon US",
  children: [
    {
      slug: "books",
      title: "Books",
      children: [
        {
          slug: "adult-coloring-books",
          title: "Adult Coloring Books",
          children: [
            { slug: "market-structure", title: "Market Structure", topicKey: "market_structure" },
            { slug: "competitor-types", title: "Competitor Types", topicKey: "competitor_set" },
            {
              slug: "customer-expectations",
              title: "Customer Expectations",
              topicKey: "customer_evidence"
            },
            {
              slug: "recurring-complaints",
              title: "Recurring Complaints",
              topicKey: "customer_evidence_complaints"
            },
            {
              slug: "pricing-and-format",
              title: "Pricing and Format",
              topicKey: "pricing"
            },
            {
              slug: "listing-conversion",
              title: "Listing Conversion",
              topicKey: "listing_conversion"
            },
            {
              slug: "keywords-and-categories",
              title: "Keywords and Categories",
              topicKey: "keywords_categories"
            },
            {
              slug: "positioning-patterns",
              title: "Positioning Patterns",
              topicKey: "positioning"
            },
            { slug: "risks-and-ip", title: "Risks and IP", topicKey: "risk_ip_policy" },
            {
              slug: "reusable-procedures",
              title: "Reusable Procedures",
              topicKey: "procedural"
            },
            {
              slug: "error-book-summary",
              title: "Error Book Summary",
              topicKey: "error_book"
            },
            { slug: "open-questions", title: "Open Questions", topicKey: "open_questions" }
          ]
        }
      ]
    }
  ]
};

export function flattenHierarchy(
  node: WikiHierarchyNode,
  parentPath = ""
): Array<{
  slug: string;
  title: string;
  path: string;
  parentPath: string | null;
  topicKey?: string;
}> {
  const path = parentPath ? `${parentPath}/${node.slug}` : `/${node.slug}`;
  const self = {
    slug: node.slug,
    title: node.title,
    path,
    parentPath: parentPath || null,
    topicKey: node.topicKey
  };
  const kids = (node.children ?? []).flatMap((c) => flattenHierarchy(c, path));
  return [self, ...kids];
}

/** Map analysis areas / memory signals to leaf wiki topic keys. */
export function topicKeysForMemory(input: {
  analysisArea?: string;
  memoryType?: string;
  statement?: string;
}): string[] {
  const keys = new Set<string>();
  if (input.memoryType === "procedural") keys.add("procedural");
  if (input.analysisArea === "market_structure") keys.add("market_structure");
  if (input.analysisArea === "competitor_set") keys.add("competitor_set");
  if (input.analysisArea === "customer_evidence") {
    keys.add("customer_evidence");
    if (/bleed|complaint|thin paper|marker/i.test(input.statement ?? "")) {
      keys.add("customer_evidence_complaints");
    }
  }
  if (input.analysisArea === "pricing" || input.analysisArea === "format_product_expectations") {
    keys.add("pricing");
  }
  if (input.analysisArea === "listing_conversion") keys.add("listing_conversion");
  if (input.analysisArea === "keywords_categories") keys.add("keywords_categories");
  if (input.analysisArea === "positioning") keys.add("positioning");
  if (input.analysisArea === "risk_ip_policy") keys.add("risk_ip_policy");
  if (keys.size === 0) keys.add("open_questions");
  return [...keys];
}
