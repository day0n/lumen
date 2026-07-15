import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const edgeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(edgeDirectory, '../../..');

test('keeps preview and production Worker targets isolated', async () => {
  const [preview, production, activeProduction] = await Promise.all([
    readFile(path.join(edgeDirectory, 'wrangler.toml'), 'utf8'),
    readFile(path.join(edgeDirectory, 'wrangler.production.toml'), 'utf8'),
    readFile(path.join(edgeDirectory, 'wrangler.production-active.toml'), 'utf8'),
  ]);

  assert.match(preview, /^name = "lumen-frontend-edge-preview"$/m);
  assert.match(preview, /^workers_dev = true$/m);
  assert.match(preview, /^bucket_name = "lumen-frontend-preview"$/m);
  assert.doesNotMatch(preview, /^\s*(?:\[\[routes\]\]|(?:route|routes)\s*=)/m);
  assert.doesNotMatch(preview, /ORIGIN_PASSTHROUGH_ENABLED/);

  assert.match(production, /^name = "lumen-frontend-edge-production"$/m);
  assert.match(production, /^workers_dev = false$/m);
  assert.match(production, /^bucket_name = "lumen-frontend-prod"$/m);
  assert.doesNotMatch(production, /^\s*(?:\[\[routes\]\]|(?:route|routes)\s*=)/m);

  assert.match(activeProduction, /^name = "lumen-frontend-edge-production"$/m);
  assert.match(activeProduction, /^workers_dev = false$/m);
  assert.match(activeProduction, /^preview_urls = false$/m);
  assert.match(activeProduction, /^bucket_name = "lumen-frontend-prod"$/m);
  assert.match(activeProduction, /^ORIGIN_PASSTHROUGH_ENABLED = "true"$/m);
  assert.equal(activeProduction.match(/^\[\[routes\]\]$/gm)?.length, 2);
  assert.match(activeProduction, /^pattern = "lumenstudio\.tech\/\*"$/m);
  assert.match(activeProduction, /^pattern = "www\.lumenstudio\.tech\/\*"$/m);
  assert.equal(activeProduction.match(/^zone_name = "lumenstudio\.tech"$/gm)?.length, 2);
  assert.doesNotMatch(activeProduction, /custom_domain/);
});

test('preview workflow audits immutable objects before activation', async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, '.github', 'workflows', 'frontend-preview.yml'),
    'utf8',
  );
  const uploadStep = workflow.indexOf('- name: Upload and audit immutable release');
  const activationStep = workflow.indexOf('- name: Activate preview release');

  assert.ok(uploadStep >= 0);
  assert.ok(activationStep > uploadStep);
  assert.match(workflow, /^\s+environment: frontend-preview$/m);
  assert.match(workflow, /^\s+cancel-in-progress: false$/m);
  assert.match(workflow, /test "\$WORKFLOW_REF" = "refs\/heads\/\$DEFAULT_BRANCH"/);
  assert.match(workflow, /git merge-base --is-ancestor "\$RELEASE" FETCH_HEAD/);
  assert.match(workflow, /FRONTEND_R2_BUCKET: lumen-frontend-preview/);
  assert.match(workflow, /--config infra\/cloudflare\/edge\/wrangler\.toml/);
  assert.match(workflow, /done <<'LANDINGS'/);
  assert.match(workflow, /\/\|en\|en\|Lumen — Turn products into videos that sell/);
  assert.match(workflow, /\/zh\|zh-CN\|zh\|Lumen — 把商品变成爆款带货视频/);
  assert.match(workflow, /data-lumen-prerendered/);
  assert.match(workflow, /data-lumen-static-landing/);
  assert.match(workflow, /landing first screen is empty/);
  assert.match(workflow, /done <<'AUTH_PAGES'/);
  assert.match(workflow, /\/sign-in\|en\|en\|Account — Lumen/);
  assert.match(workflow, /\/zh\/sign-up\|zh-CN\|zh\|账户 — Lumen/);
  assert.match(workflow, /data-lumen-static-auth/);
  assert.match(workflow, /auth page must remain noindex/);
  assert.match(workflow, /auth loading screen is empty/);
  assert.match(workflow, /done <<'NOT_FOUND_PAGES'/);
  assert.match(workflow, /\/missing-static-page\|en\|en\|Page not found — Lumen/);
  assert.match(workflow, /\/zh\/missing-static-page\|zh-CN\|zh\|页面不存在 — Lumen/);
  assert.match(workflow, /data-lumen-static-not-found/);
  assert.match(workflow, /not-found page must remain noindex/);
  assert.match(workflow, /not-found recovery screen is empty/);
  assert.doesNotMatch(workflow, /wrangler\.production\.toml|lumen-frontend-prod/);
  assert.doesNotMatch(workflow, /if:.*FRONTEND_PREVIEW_URL/);
});

test('production workflows require approval, verify origin traffic, and retain an emergency bypass', async () => {
  const [activation, bypass] = await Promise.all([
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'frontend-production.yml'), 'utf8'),
    readFile(
      path.join(repositoryRoot, '.github', 'workflows', 'frontend-production-bypass.yml'),
      'utf8',
    ),
  ]);
  const uploadStep = activation.indexOf('- name: Upload and audit immutable release');
  const activateStep = activation.indexOf('- name: Activate production release');
  const verifyStep = activation.indexOf('- name: Verify production release and origin passthrough');
  const bypassStep = activation.indexOf('- name: Bypass edge routes after failed activation');

  assert.ok(uploadStep >= 0);
  assert.ok(activateStep > uploadStep);
  assert.ok(verifyStep > activateStep);
  assert.ok(bypassStep > verifyStep);
  assert.match(activation, /^\s+environment: frontend-production$/m);
  assert.match(activation, /^\s+group: frontend-production$/m);
  assert.match(activation, /^\s+cancel-in-progress: false$/m);
  assert.match(activation, /test "\$CONFIRMATION" = "activate-production"/);
  assert.match(activation, /test "\$FRONTEND_PRODUCTION_URL" = "https:\/\/lumenstudio\.tech"/);
  assert.match(activation, /test "\$WORKFLOW_REF" = "refs\/heads\/\$DEFAULT_BRANCH"/);
  assert.match(activation, /git merge-base --is-ancestor "\$RELEASE" FETCH_HEAD/);
  assert.match(activation, /FRONTEND_R2_BUCKET: lumen-frontend-prod/);
  assert.match(activation, /wrangler\.production-active\.toml/);
  assert.match(activation, /ORIGIN_PASSTHROUGH_ENABLED:true/);
  assert.match(activation, /verify-deployment\.mjs/);
  assert.match(activation, /--base-url "https:\/\/www\.lumenstudio\.tech"/);
  assert.match(activation, /--require-origin-passthrough/);
  assert.match(activation, /steps\.route_rollback\.outputs\.armed == 'true'/);
  assert.match(activation, /remove-production-routes\.mjs/);
  assert.match(activation, /CLOUDFLARE_ZONE_ID/);

  assert.match(bypass, /^\s+environment: frontend-production$/m);
  assert.match(bypass, /^\s+group: frontend-production$/m);
  assert.match(bypass, /test "\$CONFIRMATION" = "bypass-production-edge"/);
  assert.match(bypass, /test "\$FRONTEND_PRODUCTION_URL" = "https:\/\/lumenstudio\.tech"/);
  assert.match(bypass, /remove-production-routes\.mjs/);
  assert.match(bypass, /CLOUDFLARE_ZONE_ID/);
  assert.match(bypass, /test "\$status" = "401"/);
  assert.match(bypass, /origin API response is invalid/);
});
