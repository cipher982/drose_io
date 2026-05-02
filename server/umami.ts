/**
 * Builds the Umami analytics script tag with environment-based configuration
 * Returns empty string if UMAMI_ENABLED is false or required vars are missing
 */
export function buildUmamiScript(): string {
  const enabled = Bun.env.UMAMI_ENABLED === 'true';
  const websiteId = Bun.env.UMAMI_WEBSITE_ID;
  const scriptSrc = Bun.env.UMAMI_SCRIPT_SRC || 'https://analytics.drose.io/script.js';
  const domains = Bun.env.UMAMI_DOMAINS;
  const tag = Bun.env.UMAMI_TAG || 'prod';

  if (!enabled || !websiteId) {
    return '';
  }

  const domainAttr = domains ? ` data-domains="${domains}"` : '';
  const tagAttr = tag ? ` data-tag="${tag}"` : '';
  const recorderSrc = scriptSrc.replace('script.js', 'recorder.js');

  return [
    `<script defer src="${scriptSrc}" data-website-id="${websiteId}"${domainAttr}${tagAttr} data-performance="true"></script>`,
    `<script defer src="${recorderSrc}" data-website-id="${websiteId}" data-sample-rate="1" data-mask-level="moderate" data-max-duration="1800000"></script>`,
  ].join('\n    ');
}
