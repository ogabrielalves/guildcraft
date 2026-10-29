import type { Locale, TranslationKey } from '../i18n/index.js';
import {
  LOCALES,
  LOCALE_NAMES,
  getLocale,
  isLocale,
  onLocaleChange,
  setLocale,
  t,
} from '../i18n/index.js';
import type { ConnectionState, Store } from '../state/store.js';

const CONNECTION_KEYS: Record<ConnectionState, TranslationKey> = {
  connecting: 'connection.connecting',
  open: 'connection.restored',
  closed: 'connection.lost',
  unauthorized: 'errors.UNAUTHORIZED',
};

export interface Topbar {
  readonly element: HTMLElement;
  destroy(): void;
}

export function connectionKey(state: ConnectionState): TranslationKey {
  return CONNECTION_KEYS[state];
}

export function createTopbar(store: Store): Topbar {
  const element = document.createElement('header');
  element.className = 'topbar';

  const brand = document.createElement('h1');
  brand.className = 'topbar__brand';

  const connection = document.createElement('span');
  connection.className = 'topbar__connection';
  connection.setAttribute('role', 'status');

  const language = document.createElement('label');
  language.className = 'topbar__language';
  const languageLabel = document.createElement('span');
  const select = document.createElement('select');
  for (const locale of LOCALES) {
    const option = document.createElement('option');
    option.value = locale;
    option.textContent = LOCALE_NAMES[locale];
    select.append(option);
  }
  select.addEventListener('change', () => {
    if (isLocale(select.value)) setLocale(select.value);
  });
  language.append(languageLabel, select);
  element.append(brand, connection, language);

  const renderConnection = () => {
    const state = store.getState().connection;
    connection.dataset.state = state;
    connection.textContent = t(connectionKey(state));
  };
  const renderTexts = (locale: Locale) => {
    brand.textContent = t('app.title');
    languageLabel.textContent = t('app.language');
    select.value = locale;
    renderConnection();
  };

  renderTexts(getLocale());
  const unsubscribeLocale = onLocaleChange(renderTexts);
  const unsubscribeStore = store.subscribe((state, previous) => {
    if (state.connection !== previous.connection) renderConnection();
  });

  return {
    element,
    destroy() {
      unsubscribeLocale();
      unsubscribeStore();
      element.remove();
    },
  };
}
