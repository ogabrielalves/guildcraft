// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { DICTIONARIES, getLocale, initI18n, setLocale } from '../i18n/index.js';
import { Store } from '../state/store.js';
import { connectionKey, createTopbar } from './topbar.js';

afterEach(() => {
  initI18n({ storage: null, languages: [] });
});

function parts(element: HTMLElement) {
  const brand = element.querySelector('.topbar__brand');
  const connection = element.querySelector<HTMLElement>('.topbar__connection');
  const select = element.querySelector('select');
  if (!brand || !connection || !select) throw new Error('missing topbar parts');
  return { brand, connection, select };
}

describe('connectionKey', () => {
  it.each(['connecting', 'open', 'closed', 'unauthorized'] as const)(
    'maps %s to an existing translation',
    (state) => {
      expect(DICTIONARIES.en.has(connectionKey(state))).toBe(true);
    },
  );

  it('uses the unauthorized error for rejected tokens', () => {
    expect(connectionKey('unauthorized')).toBe('errors.UNAUTHORIZED');
  });
});

describe('createTopbar', () => {
  it('renders the brand, connection state and every locale', () => {
    const { element } = createTopbar(new Store());
    const { brand, connection, select } = parts(element);
    expect(brand.textContent).toBe('Guildcraft');
    expect(connection.dataset.state).toBe('connecting');
    expect(connection.textContent).toBe('Connecting...');
    expect([...select.options].map((option) => option.value)).toEqual(['en', 'pt-BR']);
    expect(select.value).toBe('en');
  });

  it('follows connection changes', () => {
    const store = new Store();
    const { element } = createTopbar(store);
    store.setConnection('unauthorized');
    const { connection } = parts(element);
    expect(connection.dataset.state).toBe('unauthorized');
    expect(connection.textContent).toBe(DICTIONARIES.en.get('errors.UNAUTHORIZED'));
  });

  it('switches the locale from the selector and re-renders texts', () => {
    const { element } = createTopbar(new Store());
    const { connection, select } = parts(element);
    select.value = 'pt-BR';
    select.dispatchEvent(new Event('change'));
    expect(getLocale()).toBe('pt-BR');
    expect(connection.textContent).toBe('Conectando...');
    expect(element.querySelector('.topbar__language span')?.textContent).toBe('Idioma');
  });

  it('ignores unknown selector values', () => {
    const { element } = createTopbar(new Store());
    const { select } = parts(element);
    const option = document.createElement('option');
    option.value = 'xx';
    select.append(option);
    select.value = 'xx';
    select.dispatchEvent(new Event('change'));
    expect(getLocale()).toBe('en');
  });

  it('stops updating after destroy', () => {
    const store = new Store();
    const topbar = createTopbar(store);
    document.body.append(topbar.element);
    topbar.destroy();
    store.setConnection('open');
    setLocale('pt-BR');
    const { connection, brand } = parts(topbar.element);
    expect(connection.dataset.state).toBe('connecting');
    expect(brand.isConnected).toBe(false);
  });
});
