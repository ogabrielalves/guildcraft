import type { AgentAction, AgentTask, TaskStatus } from '../../shared/activity.js';
import { MAX_ACTIONS, MAX_TASKS, TASK_STATUSES } from '../../shared/activity.js';
import { describeTool } from '../hooks/describe-tool.js';
import { maskSecrets } from '../hooks/mask-secrets.js';

export const MAX_RESULT_LENGTH = 120;
export const MAX_TITLE_LENGTH = 80;
export const MAX_TASK_TITLE_LENGTH = 120;

const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const LISTING_TOOLS = new Set(['Grep', 'Glob']);
const REJECTED = /doesn't want to proceed|tool use was rejected|user rejected/i;
const INTERRUPTED = '[Request interrupted by user';
const MARKERS = [
  '"tool_use"',
  '"tool_result"',
  'Request interrupted by user',
  '"custom-title"',
  '"agent-name"',
  '"ai-title"',
];
const MAX_PENDING_CREATES = 64;

type Fields = Record<string, unknown>;
type TitleKind = 'custom' | 'agent' | 'ai';

export interface ActivitySnapshot {
  title: string | null;
  actions: AgentAction[];
  tasks: AgentTask[];
}

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

function clip(value: string, max: number): string {
  const line = maskSecrets(value.slice(0, max * 8))
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(line);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : line;
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/<\/?[a-z_-]+>/gi, '').trim())
    .filter(Boolean);
}

function summary(value: string, pick: 'first' | 'last'): string | null {
  const all = lines(value);
  const line = pick === 'first' ? all[0] : all.at(-1);
  return line ? clip(line, MAX_RESULT_LENGTH) : null;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.some((status) => status === value);
}

export class TranscriptActivity {
  private readonly actions = new Map<string, AgentAction>();
  private readonly titles: Record<TitleKind, string | null> = {
    custom: null,
    agent: null,
    ai: null,
  };
  private tasks: AgentTask[] = [];
  private readonly pendingCreates = new Map<string, string>();
  private dirty = false;

  constructor(previous: readonly AgentAction[] = []) {
    for (const action of previous.toReversed()) this.actions.set(action.id, action);
  }

  feed(line: string): void {
    if (!MARKERS.some((marker) => line.includes(marker))) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(raw) || raw.isSidechain === true) return;
    switch (raw.type) {
      case 'custom-title':
        this.setTitle('custom', raw.customTitle);
        return;
      case 'agent-name':
        this.setTitle('agent', raw.agentName);
        return;
      case 'ai-title':
        this.setTitle('ai', raw.aiTitle);
        return;
      case 'assistant':
        this.assistant(raw);
        return;
      case 'user':
        this.user(raw);
        return;
    }
  }

  takeChanged(): boolean {
    const changed = this.dirty;
    this.dirty = false;
    return changed;
  }

  snapshot(): ActivitySnapshot {
    return {
      title: this.titles.custom ?? this.titles.agent ?? this.titles.ai,
      actions: [...this.actions.values()].reverse().map((action) => ({ ...action })),
      tasks: this.tasks.map((task) => ({ ...task })),
    };
  }

  private setTitle(kind: TitleKind, value: unknown): void {
    const title = text(value);
    if (title === null) return;
    const clipped = clip(title, MAX_TITLE_LENGTH);
    if (this.titles[kind] === clipped) return;
    this.titles[kind] = clipped;
    this.dirty = true;
  }

  private assistant(raw: Fields): void {
    if (!isRecord(raw.message) || !Array.isArray(raw.message.content)) return;
    const at = timestampOf(raw);
    for (const block of raw.message.content) {
      if (!isRecord(block) || block.type !== 'tool_use') continue;
      const id = text(block.id);
      const name = text(block.name);
      if (id === null || name === null || this.actions.has(id)) continue;
      if (TASK_TOOLS.has(name)) {
        this.taskCall(id, name, block.input);
        continue;
      }
      this.actions.set(id, {
        id,
        tool: name,
        detail: describeTool(name, block.input),
        state: 'running',
        result: null,
        startedAt: at,
        endedAt: null,
      });
      while (this.actions.size > MAX_ACTIONS) {
        dropOldest(this.actions);
      }
      this.dirty = true;
    }
  }

  private user(raw: Fields): void {
    if (!isRecord(raw.message)) return;
    const { content } = raw.message;
    const blocks = Array.isArray(content) ? content.filter(isRecord) : [];
    const texts =
      typeof content === 'string' ? [content] : blocks.map((block) => contentText([block]));
    const interrupted = texts.some((value) => value.trimStart().startsWith(INTERRUPTED));
    const at = timestampOf(raw);
    const extra = isRecord(raw.toolUseResult) ? raw.toolUseResult : {};
    for (const block of blocks) {
      if (block.type === 'tool_result') this.result(block, extra, interrupted, at);
    }
    if (interrupted) this.interruptAll(at);
  }

  private result(block: Fields, extra: Fields, interrupted: boolean, at: number): void {
    const id = text(block.tool_use_id);
    if (id === null) return;
    const created = this.pendingCreates.get(id);
    if (created !== undefined) this.confirmTask(id, created, block, extra);
    const action = this.actions.get(id);
    if (action?.state !== 'running') return;
    const body = contentText(block.content);
    if (block.is_error === true) {
      action.state = interrupted ? 'interrupted' : REJECTED.test(body) ? 'rejected' : 'error';
      action.result = action.state === 'error' ? summary(body, 'first') : null;
    } else {
      action.state = 'done';
      action.result = this.resultOf(action.tool, body, extra);
    }
    action.endedAt = at;
    this.dirty = true;
  }

  private resultOf(tool: string, body: string, extra: Fields): string | null {
    if (SHELL_TOOLS.has(tool)) {
      return summary(typeof extra.stdout === 'string' ? extra.stdout : body, 'last');
    }
    return LISTING_TOOLS.has(tool) ? summary(body, 'first') : null;
  }

  private interruptAll(at: number): void {
    for (const action of this.actions.values()) {
      if (action.state !== 'running') continue;
      action.state = 'interrupted';
      action.endedAt = at;
      this.dirty = true;
    }
  }

  private taskCall(id: string, name: string, input: unknown): void {
    const fields = isRecord(input) ? input : {};
    if (name === 'TodoWrite') this.replaceTasks(fields.todos);
    else if (name === 'TaskCreate') this.createTask(id, fields);
    else if (name === 'TaskUpdate') this.updateTask(fields);
  }

  private replaceTasks(todos: unknown): void {
    if (!Array.isArray(todos)) return;
    const tasks: AgentTask[] = [];
    for (const [index, item] of todos.entries()) {
      if (!isRecord(item)) continue;
      const title = text(item.content) ?? text(item.subject) ?? text(item.title);
      if (title === null) continue;
      tasks.push({
        id: idOf(item.id) ?? String(index + 1),
        title: clip(title, MAX_TASK_TITLE_LENGTH),
        status: isTaskStatus(item.status) ? item.status : 'pending',
      });
    }
    this.setTasks(tasks);
  }

  private createTask(toolUseId: string, fields: Fields): void {
    const title = text(fields.subject) ?? text(fields.description);
    if (title === null) return;
    const id = `pending:${toolUseId}`;
    this.pendingCreates.set(toolUseId, id);
    if (this.pendingCreates.size > MAX_PENDING_CREATES) {
      dropOldest(this.pendingCreates);
    }
    this.setTasks([
      ...this.tasks.filter((task) => task.id !== id),
      { id, title: clip(title, MAX_TASK_TITLE_LENGTH), status: 'pending' },
    ]);
  }

  private confirmTask(toolUseId: string, provisional: string, block: Fields, extra: Fields): void {
    this.pendingCreates.delete(toolUseId);
    const task = isRecord(extra.task) ? extra.task : {};
    const real =
      idOf(task.id) ?? idOf(extra.taskId) ?? /#(\w+)/.exec(contentText(block.content))?.[1] ?? null;
    if (real === null || real === provisional) return;
    this.setTasks(
      this.tasks.map((item) => (item.id === provisional ? { ...item, id: real } : item)),
    );
  }

  private updateTask(fields: Fields): void {
    const id = idOf(fields.taskId);
    if (id === null || !this.tasks.some((task) => task.id === id)) return;
    if (fields.status === 'deleted') {
      this.setTasks(this.tasks.filter((task) => task.id !== id));
      return;
    }
    const title = text(fields.subject);
    this.setTasks(
      this.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              ...(isTaskStatus(fields.status) ? { status: fields.status } : {}),
              ...(title !== null ? { title: clip(title, MAX_TASK_TITLE_LENGTH) } : {}),
            }
          : task,
      ),
    );
  }

  private setTasks(tasks: AgentTask[]): void {
    this.tasks = tasks.slice(-MAX_TASKS);
    this.dirty = true;
  }
}

function dropOldest(map: Map<string, unknown>): void {
  for (const key of map.keys()) {
    map.delete(key);
    return;
  }
}

function timestampOf(raw: Fields): number {
  const at = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : Number.NaN;
  return Number.isFinite(at) ? at : Date.now();
}
