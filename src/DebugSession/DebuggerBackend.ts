import { DeviceManager, SourceCodeLocation, SourceMap, StateRequest, WARDuinoVM, WasmState, Platform, BoardFQBN, BoardBaudRate, VMConfigArgs, WASM, Breakpoint as WasmBreakpoint, OutOfPlaceVM, OutOfThingsMonitor, InputMode, ArduinoBoardBuilder, createArduinoPlatform, PlatformTarget, createDevPlatform, getFileName, equalSourceCodeLocations, LanguageAdaptor, sourceNodeFirstInstrStartAddr, HookOnWasmAddrRequest, InspectStateHook, SourceCFGNode, PauseVMHook, DebugOperations, sourceCodeLocationToString, strictEqualSourceCodeLocations} from 'wasmito';
import {EventEmitter} from 'events';
import { Context, Events } from '../State/context';
import { DebuggingMode, TargetProgram, UserDeviceConfig, UserEdwardDebuggingConfig, UserMCUConnectionConfig, UserOutOfThingsDebuggingConfig, UserRemoteDebuggingConfig } from '../DebuggerConfig';
import {  Source } from 'vscode-debugadapter';

export class BackendDebuggerEvent {
    public static readonly StateUpdated: string = 'state updated';
    public static readonly BreakpointReached: string = 'breakpoint reached';
    public static readonly NewEventArrived: string = 'New Event arrived';
    public static readonly EventHandled: string = 'Event hanlded';
    // public static readonly moduleUpdated: string = 'module updated';
    // public static readonly stepCompleted: string = 'stepped';
    // public static readonly running: string = 'running';
    // public static readonly paused: string = 'paused';
    // public static readonly exceptionOccurred: string = 'exception occurred';
    // public static readonly enforcingBreakpointPolicy: string = 'enforcing breakpoint policy';
    // public static readonly connected: string = 'connected';
    // public static readonly connectionError: string = 'connectionError';
    // public static readonly disconnected: string = 'disconnected';
    // public static readonly emulatorStarted: string = 'emulator started';
    // public static readonly emulatorClosed: string = 'emulator closed';
    // public static readonly progress: string = 'progress';
    // public static readonly errorInProgress: string = 'progress error';
    // public static readonly compiling: string = 'Compiling the code';
    // public static readonly compiled: string = 'Compiled Code';
    // public static readonly compilationFailure: string = 'Compilation failure';
    // public static readonly flashing: string = 'Flashing Code';
    // public static readonly flashingFailure: string = 'Flashing failed';
}

export class BreakpointBackend  {
    private readonly _bp: WasmBreakpoint;
    private readonly _source: Source;
    constructor(bp: WasmBreakpoint, source: Source){
        this._bp = bp;
        this._source = source;
    }

    get linenr(): number{
        return this.bp.sourceCodeLocation.linenr;
    }

    get sourceCodeLocation(): SourceCodeLocation {
        return this.bp.sourceCodeLocation;
    }

    get bp(): WasmBreakpoint {
        return this._bp;
    }

    get source(): Source {
        return this._source;
    }


    equals(otherBP: BreakpointBackend): boolean {
        return this.bp.equals(otherBP.bp);
    }
}


export enum RunningState {
    paused,
    running
}


export interface DbgOptArgs {
    initialContext?: Context
    initialRunningState?: RunningState
    isOutOfThingsDebugger?: boolean
}

export class RemoteDebuggerBackend extends EventEmitter {

    public readonly targetVM: WARDuinoVM;
    public readonly debuggingMode: DebuggingMode;
    private context: Context;

    private _breakpoints: BreakpointBackend[];

    private _monitor?: OutOfThingsMonitor;
    private _runningState: RunningState;
    private _isOutOfThingsDBG: boolean;

    constructor(vm: WARDuinoVM, debuggingMode: DebuggingMode, opts?: DbgOptArgs){
        super();
        this.targetVM = vm;
        this.debuggingMode = debuggingMode;
        this.context = opts?.initialContext ?? new Context(new WasmState({}), this.targetVM.languageAdaptor);
        this._breakpoints = [];
        this._runningState = opts?.initialRunningState ?? RunningState.paused;
        this._isOutOfThingsDBG = opts?.isOutOfThingsDebugger ?? false;
    }


    get breakpoints(): BreakpointBackend[] {
        return this._breakpoints;
    }

    set breakpoints(bps: BreakpointBackend[]) {
        this._breakpoints = bps;
    }
    
    eventsToHandle(): WASM.Event[] {
        if(this.targetVM instanceof OutOfPlaceVM){
            return this.targetVM.eventsToHandle;
        }
        return [];
    }

    isOOTDBG(): boolean {
        return this._isOutOfThingsDBG;
    }

    isPaused(): boolean{
        return this._runningState === RunningState.paused;
    }

    hasOOTMonitor(): boolean{
        return this._monitor !== undefined;
    }

    get monitor(): OutOfThingsMonitor {
        if(this._monitor === undefined){
            throw new Error('monitor was not set');
        }
        return this._monitor;
    }


    async handleEvent(eventIndex: number): Promise<void>{
        // manually handling event is only for OutOfPlace debugging
        if(!(this.targetVM instanceof OutOfPlaceVM) || this.targetVM.eventsToHandle.length === 0){
            return;
        }

        const ev = this.targetVM.eventsToHandle[0];
        const handled = await this.targetVM.handleEvent(eventIndex);
        if(!handled){
            throw Error('Event could not be handled');
        }
        const pinNr = this.takeInterruptNr(ev.topic);
        this.pinInterrupts.push(pinNr);
        
        this.emit(BackendDebuggerEvent.EventHandled, ev, this.targetVM.eventsToHandle);
    }

    async setMonitor(monitor: OutOfThingsMonitor): Promise<void>{
        this._monitor = monitor;
        await monitor.setup();
    }

    close(): Promise<boolean> {
        return this.targetVM.close();
    }

    connect(timeout?: number): Promise<boolean> {
        return this.targetVM.connect(timeout);
    }

    disconnect(): Promise<boolean> {
        return this.targetVM.disconnect();
    }

    async run(timeout?: number): Promise<boolean> {
        const running =  await this.targetVM.run(timeout);
        if(running){
            this._runningState = RunningState.running;
        }
        return running;
    }

    async pause(timeout?: number): Promise<void> {
        await this.targetVM.pause(timeout);
        this._runningState = RunningState.paused;
    }

    private isOutOfPlace(vm: WARDuinoVM): vm is OutOfPlaceVM{
        return this.targetVM instanceof OutOfPlaceVM;
    }

    private pinInterrupts: number[] = [];
    private callbacksInProgress: number[]=[];
    private returnAddress: number | undefined;
    private pinToCallbackID= new Map<number, number[]>();

    private async getCallbackTriggered() : Promise<number[]> {
        if (this.pinInterrupts.length === 0 || this.isCallBackInProgress()){
            return [];
        }

        const pinTriggered =  this.pinInterrupts.shift()!;
        let callbackIDs = this.pinToCallbackID.get(pinTriggered);
        if (callbackIDs === undefined || callbackIDs.length === 0){
            const  state = await this.targetVM.inspect(new StateRequest().includeCallbackMappings().includeTable());
            const cbs = state.callbacks;
            const tbl = state.table;
            if( cbs=== undefined || tbl === undefined){
                throw new Error('This should not occur');
            }
            for(const cb of cbs){
                const cbids = cb.tableIndexes.map((tidx)=>{
                    return tbl.elements[tidx];
                });
                const pinNr = this.takeInterruptNr(cb.callbackid);
                this.pinToCallbackID.set(pinNr, cbids);
            }

        }
        callbackIDs = this.pinToCallbackID.get(pinTriggered);
        if (callbackIDs === undefined || callbackIDs.length === 0){
            throw new Error(`Failed to find the Fun Wasm callback id triggered by pin ${pinTriggered}`);
        }
        this.callbacksInProgress =  callbackIDs;
        if(this.returnAddress === undefined){
            this.returnAddress =  this.context.pc;
        }
        return this.callbacksInProgress;
    }

    private async callbackDestinationNodes(): Promise<Array<[SourceCFGNode, number]>> {
        const dn: Array<[SourceCFGNode, number]> = [];
        const fIDs = await this.getCallbackTriggered();
        // const fIDs: number[] = [];
        for(const fID of fIDs){
            const entryNodes = this.context.langAdaptors.sourceCFGs.getFunctionSourceCFG(fID)?.entryNodes ?? [];
            for (const en of entryNodes){
                const sa = sourceNodeFirstInstrStartAddr(en);
                dn.push([en,sa]);
            }
        }

        if(fIDs.length > 0 && dn.length === 0){
        // this could happen for 3th party libs
        // for now throw error
            throw new Error(`Cannot find any SCFG for any of the callbackID ${fIDs}`);
        }

        return dn;
    }
    private async stepOutOfCallback(): Promise<Array<[SourceCFGNode, number]>> {
        //callback completed
        this.callbacksInProgress.length = 0;

        const ns = await this.callbackDestinationNodes();
        if(ns.length > 0){
            // other callback will be triggered
            // and return
            return ns;
        }

        // all callbacks completed
        // go back to the original address
        if(this.returnAddress === undefined){
            throw new Error('Failed to find a node for returnAddress');
        }

        // TODO use closestNeighbours
        const sn = this.context.langAdaptors.sourceCFGs.nodesFromAddress(this.returnAddress);
        if(sn === undefined){
            throw new Error('cannot happen');
        }
        ns.push(...DebugOperations.stepOver(this.context.langAdaptors.sourceCFGs, sn));
        this.returnAddress = undefined;
        return ns;
    }


    private isCallBackInProgress(): boolean{
        return this.callbacksInProgress.length > 0;
    }

    async step(timeout?: number): Promise<void> {
        const nextPossibleSpots = await this.callbackDestinationNodes();
        if(nextPossibleSpots.length === 0){
            // not entering in an interrupt
            const sn = this.findStartNode();
            nextPossibleSpots.push(...DebugOperations.stepIn(this.context.langAdaptors.sourceCFGs, sn));
        }

        if(nextPossibleSpots.length === 0 && this.callbacksInProgress.length > 0){
            //callback completed
            nextPossibleSpots.push(...await this.stepOutOfCallback());
        }

        await this.registerLocsAndRun(nextPossibleSpots, timeout);
    }

    async stepOut(timeout?: number): Promise<void> {
        const nextPossibleSpots: Array<[SourceCFGNode, number]> = [];
        if(this.isCallBackInProgress()){
            nextPossibleSpots.push(...await this.stepOutOfCallback());
        }
        else{
            const sn = this.findStartNode();
            nextPossibleSpots.push(...DebugOperations.stepOut(this.context.langAdaptors.sourceCFGs, sn));
        }
        await this.registerLocsAndRun(nextPossibleSpots, timeout);
    }

    async stepOver(timeout?: number): Promise<void> {
        const nextPossibleSpots: Array<[SourceCFGNode, number]> = [];
        if(this.isCallBackInProgress()){
            nextPossibleSpots.push(...await this.stepOutOfCallback());
        }
        else{
            const sn = this.findStartNode();
            nextPossibleSpots.push(...DebugOperations.stepOver(this.context.langAdaptors.sourceCFGs, sn));
        }
        await this.registerLocsAndRun(nextPossibleSpots, timeout);
    }

  
    private operationSetBreakpoints: BreakpointBackend[] = [];

    private onBreakpointReached(state: WasmState): void {
        console.log('Breakpoint reached');
        this.removeOperationBreakpoints().finally(()=>{
            this.context =  new Context(state, this.targetVM.languageAdaptor);
            this.emit(BackendDebuggerEvent.BreakpointReached, this.context, this.context.getCurrentSourceCodeLocation()!);
        });
    }


    private async removeOperationBreakpoints(timeout?: number): Promise<void>{
        for (const bp of this.operationSetBreakpoints){
            bp.sourceCodeLocation;
            const success =  await this.targetVM.removeBreakpoint(bp.bp, timeout);
            if(!success){
                throw new Error(`Failed to remove operation breakpoint set at ${sourceCodeLocationToString(bp.sourceCodeLocation)}`);
            }
        }

        this.operationSetBreakpoints.length = 0;
    }
    private findStartNode(): SourceCFGNode {
        const loc = this.context.getCurrentSourceCodeLocation();
        if(loc === undefined){
            // await this.targetVM.step();
            // await this.refreshState();
            throw new Error('Find Closest node');
        }
        return loc;
    }

    private async registerLocsAndRun(destinationNodes: Array<[SourceCFGNode, number]>, timeout?: number): Promise<boolean>{
        for (const [np, addr] of destinationNodes){
            const l = Object.assign({}, np.sourceLocation);
            l.address = addr;
            const userSetBP = this.breakpoints.find((bp)=>{
                return strictEqualSourceCodeLocations(bp.bp.sourceCodeLocation, l);
            });
            if (userSetBP !== undefined){
                // the user has placed a breakpoint
                // on the exact same location via the GUI
                // we should not add the breakpoint
                // as it will be removed afterwards
                continue;
            }

            const success =await this.addBreakpoint(l, this.operationSetBreakpoints);
            if(!success){
                throw new Error(`Failed to add bp to ${sourceCodeLocationToString(l)}`);
            }

        }
        return await this.run(timeout);
    }


    uploadSourceCode(
        sourceCodePath: string,
        timeout?: number,
    ): Promise<boolean> {
        return this.targetVM.uploadSourceCode(sourceCodePath, timeout);
    }

    proxify(timeout?: number): Promise<void> {
        return this.targetVM.proxify(timeout);
    }

    getLanguageAdaptor(): LanguageAdaptor {
        return this.targetVM.languageAdaptor;
    }

    private takeInterruptNr(s: string): number {
        const regex = /_(\d+)$/;
        const match = s.match(regex);
        if (match) {
            return parseInt(match[1], 10);
        }
        throw new Error(`could not convert ${s} to a number`);
    }


    public onNewEvent(ev: WASM.Event): void {
        let allEvents: WASM.Event[] = this.context.events.values;
        if( this.isOutOfPlace(this.targetVM)){
            allEvents = this.targetVM.eventsToHandle;
        }else{
            allEvents.push(ev);
            const pinID = this.takeInterruptNr(ev.topic);
            this.pinInterrupts.push(pinID);
        }


        this.emit(BackendDebuggerEvent.NewEventArrived, ev, allEvents);
    }

    private async addBreakpoint(sourceCodeLocation: SourceCodeLocation, buff?: BreakpointBackend[]): Promise<boolean>{
        const bp = new WasmBreakpoint(sourceCodeLocation);
        bp.subscribe(this.onBreakpointReached.bind(this));
        if(!await this.targetVM.addBreakpoint(bp)){
            return false;
        }

        const source = new Source(getFileName(sourceCodeLocation.source), sourceCodeLocation.source);
        if(buff !== undefined){
            buff.push(new BreakpointBackend(bp, source));
        }
        else{
            this.breakpoints.push(new BreakpointBackend(bp, source));
        }
        return true;
    }

    private async removeBreakpoint(sourceCodeLocation: SourceCodeLocation, timeout?: number): Promise<boolean> {
        let bpPosition = -1;
        const bpToRemove = new WasmBreakpoint(sourceCodeLocation);

        const bp = this.breakpoints.find((bp, idx) =>{
            bpPosition = idx;
            return bp.bp.equals(bpToRemove);
        });

        if(bp === undefined){
            return true;
        }
        const success =  await this.targetVM.removeBreakpoint(bp.bp, timeout);
        if(success){
            this.breakpoints.splice(bpPosition, 1);
        }
        return success;
    }

    private stateToRequest(): StateRequest {
        return new StateRequest().includePC().includeStack()
            .includeCallstack()
            .includeGlobals()
            .includeEvents();
    }

    async refreshState(): Promise<void> {
        const state = this.stateToRequest();
        const response: WasmState = await this.targetVM.sendRequest(state);
        const langAdaptor = this.targetVM.languageAdaptor;
        this.context =  new Context(response, langAdaptor);
        if(this.targetVM instanceof OutOfPlaceVM){
            this.context.events = new Events(this.targetVM.eventsToHandle, langAdaptor);
        }
        this.emit(BackendDebuggerEvent.StateUpdated, this.context);
    }


    getCurrentContext(): Context {
        return this.context;
    }

    private findClosestLocations(l: SourceCodeLocation): SourceCodeLocation[] {
        const sameSource =this.context.langAdaptors.sourceCFGs.sourceMap.mappings.filter(m=>m.source === l.source);
        const sameLine =sameSource.filter(m=> m.linenr === l.linenr);
        if (sameLine.length === 0){
            console.warn('Search for close line numbers');
        }

        let candidates = sameLine;
        if(l.colnr >= 0){
            const sameCol = sameLine.filter(m=> m.colnr === l.colnr);
            if(sameCol.length > 0){
                candidates = sameCol;
            }
        }
        
        const sorted = candidates.sort((l1, l2)=> {
            if(l1.colnr === l2.colnr) {
                return l1.address -  l2.address;
            }
            else{
                return l1.colnr - l2.colnr;
            }});

        if(sorted.length > 0){
            console.warn('TODO: find the best node for breakpoint');
            return [sorted[0]];
        }
        return sorted;
    }

    async setBreakPoints(setBps: SourceCodeLocation[]): Promise<boolean> {
        const correctedBps: SourceCodeLocation[]= [];
        for(const bp of setBps){
            const cbp = this.findClosestLocations(bp);
            correctedBps.push(...cbp);
        }

        // Find breakpoints that need to be removed 
        const bpsToDelete:SourceCodeLocation[]  = [];
        for(let bp of this.breakpoints){
            const found = correctedBps.find((b)=>{
                return equalSourceCodeLocations(b, bp.sourceCodeLocation);
            });
            if(found === undefined){
                bpsToDelete.push(bp.sourceCodeLocation);
            }
        }
        const deletedReplies: boolean[] = [];
        for (let i = 0; i < bpsToDelete.length; i++) {
            deletedReplies.push(await this.removeBreakpoint(bpsToDelete[i]));
        }
        const allDeleted = deletedReplies.reduce((acc: boolean, v: boolean) => acc && v, true);
        if(!allDeleted){
            return false;
        }

        // Keep breakpoints that need to be added
        const bpsToAdd: SourceCodeLocation[]=[];
        for (let i = 0; i < correctedBps.length; i++) {
            const found = this.breakpoints.find((b)=>{
                return equalSourceCodeLocations(b.sourceCodeLocation, correctedBps[i]);
            });
            if(found === undefined){
                bpsToAdd.push(correctedBps[i]);
            }
        }
        const addedReplies: boolean[] = [];
        for (let i = 0; i < bpsToAdd.length; i++) {
            addedReplies.push(await this.addBreakpoint(bpsToAdd[i]));
        }
        const allAdded = addedReplies.reduce((acc: boolean, v: boolean) => acc && v, true);
        return allAdded;
    }


    /**
     * When starting the debugger the Wasm execution may be at a location
     * that does not correspond with any source code location.
     * In this case, we need to advance the computation to the first reachable source code locations
     * using the current Wasm PC.
     * @returns 
     */
    async advanceToNextReachableSourceCodeLocation(timeout?: number): Promise<void>{
        const sl = this.context.getCurrentSourceCodeLocation();
        if(sl !== undefined){
            // current location already points to a source code location
            return;
        }
        // advance to the closest source code location
        const addr = this.context.pc!;
        const destinationNodes = this.getLanguageAdaptor().sourceCFGs.nextReachableSourceNodes(addr);
        this.registerLocsAndRun(destinationNodes, timeout);
    }
}

export async function createTargetVM(deviceManager: DeviceManager, platformTarget: PlatformTarget,  deploy: boolean, targetProgram: TargetProgram,  toolPort: number | undefined, mcuConfig: UserMCUConnectionConfig | undefined, pauseOnDeploy: boolean): Promise<WARDuinoVM> 
{
    if(platformTarget === PlatformTarget.DevVM){
        const platform = await createDevPlatform({
            selectedLanguage: {
                targetLanguage: targetProgram.targetLanguage,
            },
            vmConfig: {
                toolPort: toolPort,
                pauseOnStart: pauseOnDeploy
            }
        });
        if(deploy){
            return await deviceManager.spawnDevelopmentVM(platform, targetProgram.program);
        } else if(toolPort === undefined){
            throw new Error("'toolPort' is mandatory when connecting to an already deployed DevVM");
        }
        else{
            return await deviceManager.connectToExistingDevVM(platform, targetProgram.program, 3000);
        }
    }
    else{
        if(mcuConfig === undefined){
            throw new Error('MCU config is mandatory when targetting mcu');
        }
        const platform = await createArduinoPlatform({
            selectedLanguage: {
                targetLanguage: targetProgram.targetLanguage,
            },
            vmConfig: {
                fqbn: {
                    fqbn: mcuConfig.fqbn,
                    boardName: mcuConfig.boardName ?? '',
                },
                serialPort: mcuConfig.serialPort,
                baudrate: mcuConfig.baudrate,
                pauseOnStart: pauseOnDeploy,
            },
        });
        if(deploy){
            return await deviceManager.spawnHardwareVM(platform, targetProgram.program);
        } else{
            return await deviceManager.connectToExistingMCUVM(platform, targetProgram.program);
        }
    }
}


export async function setupForEdwardDebugging(devicesManager: DeviceManager, config: UserEdwardDebuggingConfig): Promise<RemoteDebuggerBackend>{
    const pauseOnDeploy = true;
    const targetVM = await createTargetVM(devicesManager, config.target, !!config.deployOnStart, config.program, config.toolPort, config.mcuConfig, pauseOnDeploy);
    let ooVM: OutOfPlaceVM | undefined;
    if(config.toolPort){
        ooVM =  await devicesManager.setupAlreadySpawnedVMForOutOfPlaceVM(config.toolPort, targetVM, config.serverPortForProxyCall, 10000);
    }else{
        ooVM = await devicesManager.spawnOutOfPlaceVM(targetVM, InputMode.RedirectInput);
    }
    const dbg = new RemoteDebuggerBackend(ooVM, DebuggingMode.edward);
    if(!(await ooVM.subscribeOnNewEvent((ev)=>{
        dbg.onNewEvent(ev);}))) {
        throw new Error('Could not subscribe to on New IO Event');
    }
    return dbg;
}


async function setupForOutOfThingsDebugging(devicesManager:DeviceManager, config: UserOutOfThingsDebuggingConfig): Promise<RemoteDebuggerBackend> {
    const pauseOnDeploy = config.pauseOnDeploy ?? true;
    const targetVM = await createTargetVM(devicesManager, config.target, !!config.deployOnStart, config.programOnTarget, config.toolPort, config.mcuConfig, pauseOnDeploy);
    const monitor = devicesManager.createOutOfThingsMonitor(targetVM);
    const dbg = new RemoteDebuggerBackend(targetVM, DebuggingMode.outOfThings, {
        initialRunningState: RunningState.paused
    });
    await dbg.setMonitor(monitor);
    return dbg;
}

async function setupForRemoteDebugging(devicesManager:DeviceManager, config: UserRemoteDebuggingConfig): Promise<RemoteDebuggerBackend> {
    const pauseOnDeploy = true;
    const targetVM = await createTargetVM(devicesManager, config.target, !!config.deployOnStart, config.program, config.toolPort, config.mcuConfig, pauseOnDeploy);
    const dbg= new RemoteDebuggerBackend(targetVM, DebuggingMode.remoteDebugging);
    if(!await targetVM.subscribeOnNewEvent(dbg.onNewEvent.bind(dbg))){
        throw new Error('Could not subscribe to on New IO Event');
    }
    return dbg;
}



export async function createDebuggerBackend(devicesManager: DeviceManager, userConfig: UserDeviceConfig): Promise<RemoteDebuggerBackend> {
    if(userConfig.debuggingMode === DebuggingMode.remoteDebugging){
        if(userConfig.remoteDebuggingConfig === undefined){
            throw new Error('remoteDebuggingConfig is missing');
        }
        return await setupForRemoteDebugging(devicesManager, userConfig.remoteDebuggingConfig);
    }
    else if(userConfig.debuggingMode === DebuggingMode.edward){
        if(userConfig.edwardDebuggingConfig  === undefined){
            throw new Error('edwardDebuggingConfig is missing');
        }
        return await setupForEdwardDebugging(devicesManager, userConfig.edwardDebuggingConfig);
    }
    else if(userConfig.debuggingMode === DebuggingMode.outOfThings){
        if(userConfig.outOfThingsConfig  === undefined){
            throw new Error('outOfThingsConfig is missing');
        }
        return await setupForOutOfThingsDebugging(devicesManager, userConfig.outOfThingsConfig);
    }
    else {
        throw new Error(`unsupported debugging mode ${userConfig.debuggingMode}`);
    }
}