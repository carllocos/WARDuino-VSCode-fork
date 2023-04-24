import { VariableInfo } from "../State/VariableInfo";
import { WOODState } from "../State/WOODState";
import { SourceMap } from "../State/SourceMap";
import { ProxyCallItem } from "../Views/ProxyCallsProvider";
import { RuntimeState } from "../State/RuntimeState";
import { Breakpoint, BreakpointPolicy } from "../State/Breakpoint";
import { DebugBridgeListenerInterface } from "./DebugBridgeListenerInterface";
import { DebuggingTimeline } from "../State/DebuggingTimeline";
import { DeviceConfig } from "../DebuggerConfig";
import { EventEmitter } from "stream";
import { ProxyMode } from "./APIRequest";

export interface DebugBridge extends EventEmitter {

  requestMissingState(): Promise<void>;

  requestStoredException(): Promise<void>;

  emitNewStateEvent(): void;

  connect(): Promise<string>;

  getDebuggingTimeline(): DebuggingTimeline;

  getCurrentState(): RuntimeState | undefined;

  updateRuntimeState(runtimeState: RuntimeState, opts?: { refreshViews?: boolean, includeInTimeline?: boolean }): void;

  isUpdateOperationAllowed(): boolean;

  getBreakpointPossibilities(): Breakpoint[];


  proxify(mode: ProxyMode): Promise<void>;

  step(): Promise<void>;

  stepBack(): void;

  run(): Promise<void>;

  pause(): Promise<void>;

  pushSession(woodState: WOODState): Promise<void>;


  popEvent(): void;

  // Adds or removes the current callback depending on whether is selected or not respectively
  updateSelectedProxies(proxy: ProxyCallItem): void;

  setSelectedProxies(proxies: Set<ProxyCallItem>): void;

  getSelectedProxies(): Set<ProxyCallItem>;

  setBreakPoints(lines: number[]): Promise<Breakpoint[]>;

  unsetAllBreakpoints(): Promise<void>;

  unsetBreakPoint(breakpoint: Breakpoint | number): void;

  refresh(): Promise<void>;

  disconnect(): void;


  upload(): void;

  updateModule(wasm: Buffer): Promise<void>;

  updateSourceMapper(newSourceMap: SourceMap): void;

  updateArgument(argument: VariableInfo): Promise<void>;

  updateLocal(local: VariableInfo): Promise<void>;

  updateGlobal(updateGlobal: VariableInfo): Promise<void>;

  getBreakpointPolicy(): BreakpointPolicy;

  setBreakpointPolicy(policy: BreakpointPolicy): void;

  getDeviceConfig(): DeviceConfig;

}