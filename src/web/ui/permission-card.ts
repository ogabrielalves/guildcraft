import type {
  PermissionAnswer,
  PermissionDecision,
  PermissionDestination,
  PermissionQuestion,
  PermissionRequestView,
} from '../../shared/permission.js';
import { MAX_OTHER_ANSWER_LENGTH } from '../../shared/permission.js';
import type { TranslationKey } from '../i18n/index.js';
import { t } from '../i18n/index.js';

const DESTINATION_KEYS: Record<PermissionDestination, TranslationKey> = {
  session: 'request.destination.session',
  localSettings: 'request.destination.localSettings',
  projectSettings: 'request.destination.projectSettings',
  userSettings: 'request.destination.userSettings',
};

export const INPUT_PREVIEW_LENGTH = 600;

export interface PermissionCardOptions {
  decide(requestId: string, decision: PermissionDecision): void;
  onTerminal(): void;
}

export interface PermissionCard {
  readonly element: HTMLElement;
  show(request: PermissionRequestView | null, queued: number): void;
  retry(requestId: string): void;
  sent(): string | null;
  renderTexts(): void;
}

export function inputPreview(request: PermissionRequestView): string | null {
  const { input } = request;
  if (input === null || input === '' || input === request.detail) return null;
  return input.length > INPUT_PREVIEW_LENGTH ? `${input.slice(0, INPUT_PREVIEW_LENGTH)}…` : input;
}

export function destinationLabel(destination: PermissionDestination): string {
  return t(DESTINATION_KEYS[destination]);
}

export function createPermissionCard(options: PermissionCardOptions): PermissionCard {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
    const target = document.createElement(tag);
    target.className = className;
    return target;
  };

  const element = make('section', 'request');
  element.hidden = true;
  element.setAttribute('role', 'alert');
  let current: PermissionRequestView | null = null;
  let queuedCount = 0;
  let decided: string | null = null;
  let selections = new Map<number, Set<number>>();
  let others = new Map<number, HTMLInputElement>();
  let buttons: HTMLButtonElement[] = [];
  let sendButton: HTMLButtonElement | null = null;

  const answered = (question: PermissionQuestion) =>
    (selections.get(question.index)?.size ?? 0) > 0 ||
    (others.get(question.index)?.value.trim() ?? '') !== '';

  const syncButtons = () => {
    const locked = current !== null && decided === current.id;
    for (const target of buttons) target.disabled = locked;
    if (sendButton && current?.questions) {
      sendButton.disabled = locked || !current.questions.every(answered);
    }
  };

  const decide = (decision: PermissionDecision) => {
    if (!current || decided === current.id) return;
    decided = current.id;
    syncButtons();
    options.decide(current.id, decision);
  };

  const button = (modifier: string, text: string, action: () => void) => {
    const target = make('button', `request__button request__button--${modifier}`);
    target.type = 'button';
    target.textContent = text;
    target.addEventListener('click', action);
    buttons.push(target);
    return target;
  };

  const answers = (questions: PermissionQuestion[]): PermissionAnswer[] =>
    questions.map((question) => {
      const answer: PermissionAnswer = {
        question: question.index,
        options: [...(selections.get(question.index) ?? [])].sort((a, b) => a - b),
      };
      const other = others.get(question.index)?.value.trim() ?? '';
      if (other !== '') answer.other = other;
      return answer;
    });

  const renderQuestion = (question: PermissionQuestion): HTMLElement => {
    const block = make('fieldset', 'request__question');
    if (question.header !== '') {
      const header = make('legend', 'request__question-header');
      header.textContent = question.header;
      block.append(header);
    }
    const text = make('p', 'request__question-text');
    text.textContent = question.question;
    const list = make('div', 'request__options');
    const chosen = new Set<number>();
    selections.set(question.index, chosen);
    const optionButtons = question.options.map((option, index) => {
      const target = button('option', option.label, () => {
        if (question.multiSelect) {
          if (chosen.has(index)) chosen.delete(index);
          else chosen.add(index);
        } else {
          const was = chosen.has(index);
          chosen.clear();
          if (!was) chosen.add(index);
        }
        for (const [i, other] of optionButtons.entries()) {
          other.setAttribute('aria-pressed', String(chosen.has(i)));
        }
        syncButtons();
      });
      target.setAttribute('aria-pressed', 'false');
      if (option.description !== '') target.title = option.description;
      return target;
    });
    list.append(...optionButtons);
    const other = make('input', 'request__other');
    other.type = 'text';
    other.maxLength = MAX_OTHER_ANSWER_LENGTH;
    other.placeholder = t('request.other');
    other.addEventListener('input', syncButtons);
    others.set(question.index, other);
    block.append(text, list, other);
    return block;
  };

  const build = (request: PermissionRequestView) => {
    buttons = [];
    selections = new Map();
    others = new Map();
    sendButton = null;
    const title = make('h3', 'request__title');
    title.textContent = t(request.questions ? 'request.question' : 'request.permission');
    const more = make('span', 'request__more');
    more.hidden = queuedCount === 0;
    more.textContent = t('request.more', { count: queuedCount });
    const head = make('header', 'request__head');
    head.append(title, more);
    const tool = make('p', 'request__tool');
    tool.textContent =
      request.subagent === null
        ? request.toolName
        : `${request.toolName} · ${t('request.subagent', { name: request.subagent })}`;
    element.replaceChildren(head, tool);
    const repeated = request.questions?.some((item) => item.question === request.detail) === true;
    if (request.detail !== '' && !repeated) {
      const detail = make('p', 'request__detail');
      detail.textContent = request.detail;
      detail.title = request.detail;
      element.append(detail);
    }
    const preview = inputPreview(request);
    if (preview !== null) {
      const input = make('pre', 'request__input');
      input.textContent = preview;
      element.append(input);
    }
    const actions = make('div', 'request__actions');
    const { questions } = request;
    if (questions) {
      element.append(...questions.map(renderQuestion));
      sendButton = button('send', t('request.send'), () => {
        decide({ behavior: 'answer', answers: answers(questions) });
      });
      actions.append(sendButton);
    } else {
      actions.append(
        button('allow', t('request.allow'), () => {
          decide({ behavior: 'allow' });
        }),
      );
    }
    actions.append(
      button('deny', t('request.deny'), () => {
        decide({ behavior: 'deny' });
      }),
    );
    element.append(actions);
    if (request.suggestions.length > 0) {
      const always = make('div', 'request__suggestions');
      always.append(
        ...request.suggestions.map((suggestion) => {
          const target = button(
            'always',
            t('request.always', { rules: suggestion.rules.join(', ') }),
            () => {
              decide({ behavior: 'allow', suggestion: suggestion.index });
            },
          );
          target.title = destinationLabel(suggestion.destination);
          return target;
        }),
      );
      element.append(always);
    }
    const terminal = button('terminal', t('request.terminal'), () => {
      if (!current || decided === current.id) return;
      decide({ behavior: 'terminal' });
      options.onTerminal();
    });
    element.append(terminal);
    syncButtons();
  };

  return {
    element,
    show(request, queued) {
      const changed = request?.id !== current?.id || queued !== queuedCount;
      const sameRequest = request !== null && request.id === current?.id;
      current = request;
      queuedCount = queued;
      element.hidden = request === null;
      if (request === null) {
        element.replaceChildren();
        return;
      }
      if (sameRequest && changed) {
        const more = element.querySelector<HTMLElement>('.request__more');
        if (more) {
          more.hidden = queued === 0;
          more.textContent = t('request.more', { count: queued });
        }
        return;
      }
      if (changed) build(request);
    },
    retry(requestId) {
      if (decided !== requestId) return;
      decided = null;
      syncButtons();
    },
    sent: () => decided,
    renderTexts() {
      if (current) build(current);
    },
  };
}
