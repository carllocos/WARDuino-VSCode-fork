import { VariableInfo } from "../State/VariableInfo";
import { Frame } from "../Parsers/Frame";
import { WOODState } from "../State/WOODState";
import { SourceMap } from "../State/SourceMap";
import { EventItem } from "../Views/EventsProvider";
import { ProxyCallItem } from "../Views/ProxyCallsProvider";
import { RuntimeState } from "../State/RuntimeState";
import { Breakpoint, BreakpointPolicy } from "../State/Breakpoint";
import { DebugBridgeListener } from "./DebugBridgeListener";

export interface DebugBridge {
    client: Duplex | undefined;

    setStartAddress(startAddress: number): void;

    connect(): Promise<string>;

    getCurrentState(): RuntimeState | undefined;

    updateRuntimeState(runtimeState: RuntimeState): void;

    getProgramCounter(): number;

    setProgramCounter(pc: number): void;

    getBreakpointPossibilities(): Breakpoint[];

    getLocals(fidx: number): VariableInfo[];

    setLocals(fidx: number, locals: VariableInfo[]): void;

    getCallstack(): Frame[];

    setCallstack(callstack: Frame[]): void;

    getCurrentFunctionIndex(): number;

    step(): void;

    stepBack(): void;

    run(): void;

    pause(): void;

    hitBreakpoint(): void;

    pullSession(): void;

    pushSession(woodState: WOODState): void;

    refreshEvents(events: EventItem[]): void;

    popEvent(): void;

    // Adds or removes the current callback depending on whether is selected or not respectively
    updateSelectedProxies(proxy: ProxyCallItem): void;

    setSelectedProxies(proxies: Set<ProxyCallItem>): void;

    getSelectedProxies(): Set<ProxyCallItem>;

    setBreakPoints(lines: number[]): Breakpoint[];

    unsetAllBreakpoints(): void;

    unsetBreakPoint(breakpoint: Breakpoint | number): void;

    refresh(): void;

    notifyNewEvent(): void;

    disconnect(): void;

    setVariable(name: string, value: number): Promise<string>;

    upload(): void;

    updateModule(wasm: Buffer): void;

    updateSourceMapper(newSourceMap: SourceMap): void;

    updateLocal(local: VariableInfo): Promise<string>;

    updateGlobal(updateGlobal: VariableInfo): Promise<string>;

    getBreakpointPolicy(): BreakpointPolicy;

    setBreakpointPolicy(policy: BreakpointPolicy): void;

    getListener(): DebugBridgeListener;

}
