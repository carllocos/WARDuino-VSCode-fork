import { OldRuntimeState } from './RuntimeState';

export class DebuggingTimeline {

    private runtimes: OldRuntimeState[];
    private activeStateIdx: number;

    constructor() {
        this.activeStateIdx = -1;
        this.runtimes = [];
    }

    public getActiveState(): OldRuntimeState | undefined {
        return this.getStateFromIndex(this.activeStateIdx);
    }

    public getIndexOfActiveState(): number | undefined {
        return this.activeStateIdx == -1 ? undefined : this.activeStateIdx;
    }

    public addRuntime(runtimeState: OldRuntimeState) {
        this.runtimes.push(runtimeState);
    }

    public getLastState(): OldRuntimeState | undefined {
        if (this.runtimes.length > 0) {
            return this.runtimes[this.runtimes.length - 1];
        }
        return undefined;
    }

    public activateStateFromIndex(idx: number): boolean {
        if (idx < 0 || idx >= this.runtimes.length || this.runtimes.length == 0) {
            return false;
        }
        this.activeStateIdx = idx;
        return true;
    }

    public getStartState() {
        return this.getStateFromIndex(0);
    }

    public getStateFromIndex(idx: number): OldRuntimeState | undefined {
        if (idx < 0 || idx >= this.runtimes.length || this.runtimes.length == 0) {
            return undefined;
        }
        return this.runtimes[idx];
    }

    public advanceTimeline(): OldRuntimeState | undefined {
        let state = undefined;
        if (this.activeStateIdx + 1 < this.runtimes.length) {
            this.activeStateIdx += 1;
            state = this.getStateFromIndex(this.activeStateIdx);
        }
        return state;
    }


    public advanceToPresent(): void {
        this.activeStateIdx = this.runtimes.length - 1;
    }

    public goBackTimeline(): OldRuntimeState | undefined {
        let state = undefined;
        if (this.activeStateIdx >= 1) {
            this.activeStateIdx -= 1;
            state = this.runtimes[this.activeStateIdx];
        }
        return state;
    }


    public isActiveStatePresent(): boolean {
        return this.activeStateIdx === (this.runtimes.length - 1);
    }

    public isActiveStateTheStart(): boolean {
        return this.activeStateIdx === 0;
    }

    public getRuntimesChronologically(): OldRuntimeState[] {
        return this.runtimes;
    }

    public size(): number {
        return this.runtimes.length;
    }

    public makeCurrentStateNewPresent() {
        if (this.activeStateIdx === -1) {
            return;
        }
        this.runtimes = this.runtimes.slice(0, this.activeStateIdx + 1);
    }

    public clear(): void {
        this.activeStateIdx = -1;
        this.runtimes = [];
    }
}