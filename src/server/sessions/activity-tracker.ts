import type { AgentActivity } from '../../shared/activity.js';
import { emptyActivity } from '../../shared/activity.js';
import { TranscriptActivity } from './transcript-activity.js';
import type { OpenTail } from './transcript-tail.js';
import { TranscriptTail, openTailFile } from './transcript-tail.js';

interface Entry {
  tail: TranscriptTail;
  parser: TranscriptActivity;
  activity: AgentActivity;
}

export class ActivityTracker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly openFile: OpenTail = openTailFile) {}

  get(agentId: string): AgentActivity {
    return this.entries.get(agentId)?.activity ?? emptyActivity(agentId);
  }

  remove(agentId: string): void {
    this.entries.delete(agentId);
  }

  async poll(agentId: string, path: string): Promise<AgentActivity | null> {
    let entry = this.entries.get(agentId);
    let changed = false;
    if (entry?.tail.path !== path) {
      const previous = entry?.activity;
      changed = previous !== undefined && (previous.title !== null || previous.tasks.length > 0);
      entry = {
        tail: new TranscriptTail(path, this.openFile),
        parser: new TranscriptActivity(previous?.actions),
        activity: { ...emptyActivity(agentId), actions: previous?.actions ?? [] },
      };
      this.entries.set(agentId, entry);
    }
    let read;
    try {
      read = await entry.tail.read();
    } catch {
      return changed ? entry.activity : null;
    }
    if (this.entries.get(agentId) !== entry) return null;
    if (read.reset) {
      entry.parser = new TranscriptActivity(entry.activity.actions);
      changed = true;
    }
    for (const line of read.lines) entry.parser.feed(line);
    if (!entry.parser.takeChanged() && !changed) return null;
    entry.activity = { agentId, ...entry.parser.snapshot() };
    return entry.activity;
  }
}
