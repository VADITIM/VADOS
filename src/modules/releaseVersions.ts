import { onMounted, ref, type Ref } from 'vue';

import type { Product } from './productsRegistry';

const GITHUB_PREFIX = 'https://github.com/';
const RELEASE_ENDPOINT = 'https://api.github.com/repos';
const STORAGE_PREFIX = 'release-version:';
const VERSION_PATTERN = /^v?(\d+\.\d+\.\d+)$/;

function readStored(repository: string): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_PREFIX + repository);
  } catch {
    return null;
  }
}

function writeStored(repository: string, version: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + repository, version);
  } catch {
    return;
  }
}

async function fetchLatestVersion(repository: string): Promise<string | null> {
  const stored = readStored(repository);
  if (stored) return stored;
  try {
    const response = await fetch(`${RELEASE_ENDPOINT}/${repository}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const release: { tag_name?: string } = await response.json();
    const match = release.tag_name?.match(VERSION_PATTERN);
    if (!match) return null;
    writeStored(repository, match[1]);
    return match[1];
  } catch {
    return null;
  }
}

export function useLatestVersion(product: Product): Ref<string> {
  const version = ref(product.version);
  onMounted(async () => {
    if (!product.repositoryUrl?.startsWith(GITHUB_PREFIX)) return;
    const latest = await fetchLatestVersion(product.repositoryUrl.slice(GITHUB_PREFIX.length));
    if (latest) version.value = latest;
  });
  return version;
}
