import {DebugBridge} from './DebugBridge';
import {Frame} from '../Parsers/Frame';
import {VariableInfo} from '../State/VariableInfo';
import {getLocationForAddress, SourceMap} from '../State/SourceMap';
import {ExecutionStateType, WOODDumpResponse, WOODState} from '../State/WOODState';
import {InterruptTypes} from './InterruptTypes';
import {FunctionInfo} from '../State/FunctionInfo';
import {ProxyCallItem} from '../Views/ProxyCallsProvider';
import {RuntimeState} from '../State/RuntimeState';
import {Breakpoint, BreakpointPolicy, UniqueSet} from '../State/Breakpoint';
import {HexaEncoder} from '../Util/hexaEncoding';
import {DeviceConfig} from '../DebuggerConfig';
import {DebuggingTimeline} from '../State/DebuggingTimeline';
import {ChannelInterface} from '../Channels/ChannelInterface';
import {
    PauseRequest,
    Request,
    RunRequest,
    StackValueUpdateRequest,
    StateRequest,
    UpdateGlobalRequest,
    UpdateModuleRequest,
    UpdateStateRequest
} from './APIRequest';
import {EventItem} from '../Views/EventsProvider';
import EventEmitter = require('events');

export class Messages {
    public static readonly compiling: string = 'Compiling the code';
    public static readonly compiled: string = 'Compiled Code';
    public static readonly reset: string = 'Press reset button';
    public static readonly transfering: string = 'Transfering state';
    public static readonly uploading: string = 'Uploading to board';
    public static readonly connecting: string = 'Connecting to board';
    public static readonly connected: string = 'Connected to board';
    public static readonly disconnected: string = 'Disconnected board';
    public static readonly initialisationFailure: string = 'Failed to initialise';
    public static readonly connectionFailure: string = 'Failed to connect device';
}

export class EventsMessages {
    public static readonly stateUpdated: string = 'state updated';
    public static readonly moduleUpdated: string = 'module updated';
    public static readonly stepCompleted: string = 'stepped';
    public static readonly running: string = 'running';
    public static readonly paused: string = 'paused';
    public static readonly exceptionOccurred: string = 'exception occurred';
    public static readonly enforcingBreakpointPolicy: string = 'enforcing breakpoint policy';
    public static readonly connected: string = 'connected';
    public static readonly connectionError: string = 'connectionError';
    public static readonly disconnected: string = 'disconnected';
    public static readonly emulatorStarted: string = 'emulator started';
    public static readonly emulatorClosed: string = 'emulator closed';
    public static readonly progress: string = 'progress';
    public static readonly errorInProgress: string = 'progress error';
    public static readonly compiling: string = 'Compiling the code';
    public static readonly compiled: string = 'Compiled Code';
    public static readonly compilationFailure: string = 'Compilation failure';
    public static readonly flashing: string = 'Flashing Code';
    public static readonly flashingFailure: string = 'Flashing failed';
    public static readonly atBreakpoint: string = 'At breakpoint';
}


export abstract class AbstractDebugBridge extends EventEmitter implements DebugBridge {
    // State
    protected sourceMap: SourceMap;
    protected startAddress: number = 0;
    protected pc: number = 0;
    protected callstack: Frame[] = [];
    protected selectedProxies: Set<ProxyCallItem> = new Set<ProxyCallItem>();
    protected breakpoints: UniqueSet<Breakpoint> = new UniqueSet<Breakpoint>();

    // Interfaces
    protected abstract client: ChannelInterface | undefined;

    // History (time-travel)
    protected timeline: DebuggingTimeline = new DebuggingTimeline();

    public readonly deviceConfig: DeviceConfig;
    public outOfPlaceActive = false;

    protected constructor(deviceConfig: DeviceConfig, sourceMap: SourceMap) {
        super();
        this.sourceMap = sourceMap;
        const callbacks = sourceMap?.importInfos ?? [];
        this.selectedProxies = new Set<ProxyCallItem>(callbacks.map((primitive: FunctionInfo) => (new ProxyCallItem(primitive))))
            ?? new Set<ProxyCallItem>();
        this.deviceConfig = deviceConfig;
    }

    // General Bridge functionality

    abstract connect(flash?: boolean): Promise<string>;

    abstract disconnect(): void;

    abstract disconnectMonitor(): void;

    abstract upload(): void;

    // Debug API

    abstract proxify(): Promise<void>;

    public async run(): Promise<void> {
        await this.client?.request(RunRequest);
        this.emit(EventsMessages.running);
    }

    public async pause(): Promise<void> {
        const req = PauseRequest;
        await this.client?.request(req);
        await this.refresh();
        this.emit(EventsMessages.paused);
    }

    public async step(): Promise<void> {
        const runtimeState = this.timeline.advanceTimeline();
        if (!!runtimeState) {
            // Time travel forward
            const doNotSave = {includeInTimeline: false};
            this.updateRuntimeState(runtimeState, doNotSave);
        } else {
            let runtimeState: RuntimeState | undefined;
            do {
                await this.client?.request({
                    dataToSend: InterruptTypes.interruptSTEP + '\n',
                    expectedResponse: (line) => {
                        return line.includes('STEP');
                    },
                });
                // Normal step forward
                runtimeState = await this.refresh();
            } while (getLocationForAddress(this.sourceMap, runtimeState.getProgramCounter()) === undefined);
            this.updateRuntimeState(runtimeState);
        }
        this.emit(EventsMessages.stepCompleted);
    }

    public stepBack() {
        // Time travel backward
        const rs = this.timeline.isActiveStateTheStart() ? this.timeline.getStartState() : this.timeline.goBackTimeline();
        if (!!rs) {
            const doNotSave = {includeInTimeline: false};
            this.updateRuntimeState(rs, doNotSave);
            this.emit(EventsMessages.paused);
        }
    }

    abstract refresh(): Promise<RuntimeState>;


    public getBreakpoints(): Breakpoint[] {
        return Array.from(this.breakpoints);
    }

    public async unsetAllBreakpoints(): Promise<void> {
        await Promise.all(Array.from(this.breakpoints).map(bp => this.unsetBreakPoint(bp)));
    }

    public async unsetBreakPoint(breakpoint: Breakpoint | number) {
        let breakPointAddress: string = HexaEncoder.serializeUInt32BE(breakpoint instanceof Breakpoint ? breakpoint.id : breakpoint);
        const bp = breakpoint instanceof Breakpoint ? breakpoint : this.getBreakpointFromAddr(breakpoint);
        const req: Request = {
            dataToSend: `${InterruptTypes.interruptBPRem}${breakPointAddress}\n`,
            expectedResponse: (line: string) => {
                return line === `BP ${bp!.id}!`;
            }
        };
        await this.client?.request(req);
        console.log(`BP removed at line ${bp!.line} (Addr ${bp!.id})`);
        this.breakpoints.delete(bp);
    }

    private getBreakpointFromAddr(addr: number): Breakpoint | undefined {
        return Array.from(this.breakpoints).find(bp => bp.id === addr);
    }

    private async setBreakPoint(breakpoint: Breakpoint): Promise<Breakpoint> {
        const breakPointAddress: string = HexaEncoder.serializeUInt32BE(breakpoint.id);
        const req: Request = {
            dataToSend: `${InterruptTypes.interruptBPAdd}${breakPointAddress}\n`,
            expectedResponse: (line: string) => {
                return line === `BP ${breakpoint.id}!`;
            }
        };
        await this.client?.request(req);
        console.log(`BP added at line ${breakpoint.line} (Addr ${breakpoint.id})`);
        this.breakpoints.add(breakpoint);
        return breakpoint;
    }


    private async onBreakpointReached(line: string) {
        let breakpointInfo = line.match(/AT ([0-9]+)!/);
        if (!!breakpointInfo && breakpointInfo.length > 1) {
            let bpAddress = parseInt(breakpointInfo[1]);
            const lineBP = this.getBreakpointFromAddr(bpAddress)?.line;
            console.log(`BP reached at line ${lineBP} (addr=${bpAddress})`);
            this.emit(EventsMessages.atBreakpoint, this, lineBP);
            this.updateRuntimeState(await this.refresh());

            const dc = this.deviceConfig;
            if (dc.isBreakpointPolicyEnabled()) {
                if (dc.getBreakpointPolicy() === BreakpointPolicy.singleStop) {
                    this.emit(EventsMessages.enforcingBreakpointPolicy, this, BreakpointPolicy.singleStop);
                    await this.unsetAllBreakpoints();
                    await this.run();
                } else if (dc.getBreakpointPolicy() === BreakpointPolicy.removeAndProceed) {
                    this.emit(EventsMessages.enforcingBreakpointPolicy, this, BreakpointPolicy.removeAndProceed);
                    await this.unsetBreakPoint(bpAddress);
                    await this.run();
                }
            } else {
                this.emit(EventsMessages.paused);
            }
        }
    }

    protected registerCallbacks() {
        this.registerAtBPCallback();
        this.registerOnNewPushedEventCallback();
        this.registerOnExceptionCallback();
    }

    public async setBreakPoints(lines: number[]): Promise<Breakpoint[]> {
        // Delete absent breakpoints
        await Promise.all(Array.from<Breakpoint>(this.breakpoints.values())
            .filter((breakpoint) => !lines.includes(breakpoint.id))
            .map(breakpoint => this.unsetBreakPoint(breakpoint)));

        // Add missing breakpoints
        await Promise.all(
            lines
                .filter((line) => {
                    return this.isNewBreakpoint(line);
                })
                .map(line => {
                    const breakpoint: Breakpoint = new Breakpoint(this.lineToAddress(line), line);
                    return this.setBreakPoint(breakpoint);
                })
        );
        return Array.from(this.breakpoints.values());  // return new breakpoints list
    }

    private isNewBreakpoint(line: Number): boolean {
        const lineInfoPair = this.sourceMap?.lineInfoPairs.find(info => info.lineInfo.line === line);
        return lineInfoPair !== undefined
            && !Array.from<Breakpoint>(this.breakpoints.values()).some(value => value.id === line);
    }

    private lineToAddress(line: number): number {
        const lineInfoPair = this.sourceMap?.lineInfoPairs.find(info => info.lineInfo.line === line);
        return parseInt('0x' + lineInfoPair?.lineAddress ?? '');
    }


    public async pushSession(woodState: WOODState): Promise<void> {
        const messages: string[] = woodState.toBinary();
        const requests: Request[] = UpdateStateRequest(messages);
        console.log(`sending ${messages.length} messages as new State\n`);
        const promises = requests.map(req => {
            return this.client!.request(req);
        });
        await Promise.all(promises);
    }

    public popEvent(): void {
        this.sendInterrupt(InterruptTypes.interruptPOPEvent);
    }

    // Helper functions

    //TODO remove
    protected sendInterrupt(i: InterruptTypes, callback?: (error: Error | null | undefined) => void) {
        if (!!this.client) {
            return this.client?.write(`${i} \n`, callback);
        }
        // else {
        //     return this.socketConnection?.write(`${i} \n`, callback);
        // }
    }


    protected getPrimitives(): number[] {
        return this.sourceMap?.importInfos.map((primitive: FunctionInfo) => (primitive.index)) ?? [];
    }

    public getSelectedProxies(): Set<ProxyCallItem> {
        return this.selectedProxies;
    }

    protected getSelectedProxiesByIndex(): number[] {
        return [...this.selectedProxies].filter((proxyItem: ProxyCallItem) => {
            return proxyItem.isSelected();
        }).map((callback: ProxyCallItem) => (callback.index));
    }

    public setSelectedProxies(proxies: Set<ProxyCallItem>) {
        this.selectedProxies = proxies;
    }

    public async updateSelectedProxies(proxy: ProxyCallItem): Promise<void> {
        console.warn('Only WOOD Emulator Debug Bridge needs proxies');
    }


    public async updateSelectedMock(): Promise<void> {
        const funs_to_mock = Array.from(this.selectedProxies).filter(func=>{
            return !func.isSelected() && this.deviceConfig.getMockConfig().functions.has(func.index);
        }).map(func=>func.index);

        const requests: Promise<string>[] = funs_to_mock.map(fun_idx =>{
            const target_func = this.deviceConfig.getMockConfig().functions.get(fun_idx);
            console.info(`Mock: local function ${fun_idx} mocked by ${target_func}`);
            return this.client!.request(makeMockRequest(fun_idx, target_func!));
        });
        const replies = await Promise.all(requests);
        replies.forEach(r=>{
            console.log(`Got Mock reply ${r}`);
        });
        return ;
    }


    // Getters and Setters

    public getSourceMap(): SourceMap {
        return this.sourceMap;
    }

    async requestMissingState(): Promise<void> {
        const missing: ExecutionStateType[] = this.getCurrentState()?.getMissingState() ?? [];
        const stateRequest = StateRequest.fromList(missing);
        if (stateRequest.isRequestEmpty()) {
            // promise that resolves instantly
            return new Promise((res) => {
                res();
            });
        }
        const req = stateRequest.generateRequest();
        const response = await this.client!.request(req);
        const missingState = new RuntimeState(response, this.sourceMap);
        const state = this.getCurrentState();
        state!.copyMissingState(missingState);
        const pc = state!.getProgramCounter();
        const loc = getLocationForAddress(this.sourceMap, pc);
        console.log(`PC=${pc} (Hexa ${pc.toString(16)}, line ${loc?.line}, column ${loc?.column})`);
        return;
    }

    getDeviceConfig() {
        return this.deviceConfig;
    }

    getDebuggingTimeline(): DebuggingTimeline {
        return this.timeline;
    }

    getCurrentState(): RuntimeState | undefined {
        return this.timeline.getActiveState();
    }

    updateRuntimeState(runtimeState: RuntimeState, opts?: { refreshViews?: boolean, includeInTimeline?: boolean }) {
        const includeInTimeline = opts?.includeInTimeline ?? true;
        if (includeInTimeline && this.timeline.isActiveStatePresent()) {
            this.timeline.addRuntime(runtimeState.deepcopy());
            if (!!!this.timeline.advanceTimeline()) {
                throw new Error('Timeline should be able to advance');
            }
        }
        this.emitNewStateEvent();
    }

    public isUpdateOperationAllowed(): boolean {
        return this.timeline.isActiveStatePresent() || !!this.timeline.getActiveState()?.hasAllState();
    }

    public emitNewStateEvent() {
        const currentState = this.getCurrentState();
        const pc = currentState!.getProgramCounter();
        const loc = getLocationForAddress(this.sourceMap, pc);
        console.log(`PC=${pc} (Hexa ${pc.toString(16)}, line ${loc?.line}, column ${loc?.column})`);
        this.emit(EventsMessages.stateUpdated, currentState);
        if (currentState?.hasException()) {
            this.emit(EventsMessages.exceptionOccurred, this, currentState);
        }
    }

    getProgramCounter(): number {
        return this.pc;
    }

    setProgramCounter(pc: number) {
        this.pc = pc;
    }

    getBreakpointPossibilities(): Breakpoint[] {
        return this.sourceMap?.lineInfoPairs.map(info => new Breakpoint(this.lineToAddress(info.lineInfo.line), info.lineInfo.line)) ?? [];
    }


    async updateLocal(local: VariableInfo): Promise<void> {
        const state = this.getCurrentState()?.getWasmState();
        const command = state?.serializeStackValueUpdate(local.index);
        if (!!!command) {
            return;
        }

        const req = StackValueUpdateRequest(local.index, command);
        await this.client!.request(req);
    }

    async updateGlobal(global: VariableInfo): Promise<void> {
        const state = this.getCurrentState()?.getWasmState();
        const command = state?.serializeGlobalValueUpdate(global.index);
        if (!!!command) {
            return;
        }
        const req = UpdateGlobalRequest(global.index, command);
        await this.client!.request(req);
    }

    async updateArgument(argument: VariableInfo): Promise<void> {
        await this.updateLocal(argument);
    }


    updateSourceMapper(newSourceMap: SourceMap): void {
        this.sourceMap = newSourceMap;
    }

    public async updateModule(wasm: Buffer): Promise<void> {
        const req = UpdateModuleRequest(wasm);
        await this.client!.request(req);
        this.getDebuggingTimeline().clear();
        this.emit(EventsMessages.moduleUpdated, this);
    }

    private async refreshEvents() {
        const stateReq = new StateRequest();
        stateReq.includeEvents();
        const req = stateReq.generateRequest();
        const evtsLine = await this.client!.request(req);
        const rs = this.getCurrentState();
        const evts = JSON.parse(evtsLine).events;
        if (!!rs && !!evts) {
            rs.setEvents(evts.map((obj: EventItem) => (new EventItem(obj.topic, obj.payload))));
            this.emitNewStateEvent();
        }
    }

    private registerAtBPCallback() {
        this.client?.addCallback(
            (line: string) => !!line.match(/AT ([0-9]+)!/),
            (line: string) => {
                this.onBreakpointReached(line);
            }
        );
    }

    private registerOnNewPushedEventCallback() {
        //callback that requests the new events
        this.client?.addCallback(
            (line: string) => {
                return line === 'new pushed event';
            },
            (line: string) => {
                this.refreshEvents();
            }
        );
    }

    private registerOnExceptionCallback() {
        this.client?.addCallback(
            (line: string) => {
                if (!line.startsWith('{"')) {
                    return false;
                }
                try {
                    const parsed: WOODDumpResponse = JSON.parse(line);
                    return parsed.pc_error !== undefined && parsed.exception_msg !== undefined;
                } catch (err) {
                    return false;
                }
            },
            (line: string) => {
                this.onExceptionCallback(line);
            }
        );
    }

    private onExceptionCallback(line: string) {
        const runtimeState: RuntimeState = new RuntimeState(line, this.sourceMap);
        this.updateRuntimeState(runtimeState);
    }
}


function encodeLEB128(n: number): Uint8Array {
    const result = [];
    while (true) {
        let _byte: number = n & 0x7F; // Get the lowest 7 bits of the number
        n >>>= 7;
        if (n !== 0) {
            _byte |= 0x80; // Set the highest bit to 1 to indicate continuation
        }
        result.push(_byte);
        if (n === 0) {
            break;
        }
    }
    return new Uint8Array(result);
}

function serializeAroundRequest(kind: number, funid: number, targetID: number){
    const encodedFidx = Buffer.concat([encodeLEB128(funid)]).toString('hex');
    const encodedSchedule = '03'; // always
    const encodedRemoteCallHookID = '01'; // remote call
    const encodedRemoteFidx = Buffer.concat([encodeLEB128(targetID)]).toString('hex');
    return `${InterruptTypes.interruptAroundFunction}${encodedFidx}${encodedSchedule}${encodedRemoteCallHookID}${encodedRemoteFidx}\n`;
    //return '50' + buf_kind + Buffer.concat([buf_f, buf_t]).toString('hex') + '\n';
}

interface MockAnswer {
    interrupt: number,
    kind: number,
    error_code?: number
}

function makeMockRequest(fun_to_mock: number, mock_fun_id: number): Request {
    return {
        dataToSend: serializeAroundRequest(1, fun_to_mock, mock_fun_id),
        expectedResponse: (line: string) =>{
            try{
                const answer :  MockAnswer = JSON.parse(line);
                return true;
            }
            catch(e){
                return false;
            }
        }
    };
}