import { DeviceManager, DeploymentMode, SourceCodeLocation, SourceMap, StateRequest, WARDuinoVM, WasmState, PlatformBuilderConfig, Platform, BoardFQBN, DeviceConfigArgs, BoardBaudRate, VMConfigArgs, listAvailableBoards, WASM, OutOfPlaceMode } from 'wasmito';
import {EventEmitter} from 'events';
import { Context } from '../State/context';
import { DebuggingMode, UserConfig, createVMConfig as createVMConfigArgs} from '../DebuggerConfig';
import { Source, Breakpoint as VSCodeBreakpoint } from 'vscode-debugadapter';
import { Breakpoint, OutOfPlaceVM} from 'wasmito';

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

export class BreakpointBackend extends VSCodeBreakpoint {
    private readonly _bp: Breakpoint;
    constructor(bp: Breakpoint, source: Source){
        super(true, bp.sourceCodeLocation.linenr, bp.sourceCodeLocation.columnStart, source);
        this._bp = bp;
    }

    get linenr(): number{
        return this.bp.sourceCodeLocation.linenr;
    }

    get sourceCodeLocation(): SourceCodeLocation {
        return this.sourceCodeLocation;
    }

    get bp(): Breakpoint {
        return this._bp;
    }


    equals(otherBP: BreakpointBackend): boolean {
        return this.bp.equals(otherBP.bp);
    }
}

export class RemoteDebuggerBackend extends EventEmitter {

    private readonly vm: WARDuinoVM;
    private context: Context;

    private _breakpoints: BreakpointBackend[];

    constructor(vm: WARDuinoVM){
        super();
        this.vm = vm;
        this.context = new Context(new WasmState({}), this.vm.getSourceMap()!);
        this._breakpoints = [];
    }


    get breakpoints(): BreakpointBackend[] {
        return this._breakpoints;
    }

    async handleEvent(eventIndex: number): Promise<void>{
        // manually handling event is only for OutOfPlace debugging
        if(!(this.vm instanceof OutOfPlaceVM) || this.vm.eventsToHandle.length === 0){
            return;
        }

        const ev = this.vm.eventsToHandle[0];
        const handled = await this.vm.handleEvent(eventIndex);
        if(!handled){
            throw Error('Event could not be handled');
        }
        
        this.emit(BackendDebuggerEvent.EventHandled, ev, this.vm.eventsToHandle);
    }

    close(): Promise<boolean> {
        return this.vm.close();
    }

    connect(timeout?: number): Promise<boolean> {
        return this.vm.connect(timeout);
    }

    disconnect(): Promise<boolean> {
        return this.vm.disconnect();
    }

    run(timeout?: number): Promise<boolean> {
        return this.vm.run(timeout);
    }

    pause(timeout?: number): Promise<void> {
        return this.vm.pause(timeout);
    }

    async step(timeout?: number): Promise<void> {
        await this.vm.step(timeout);
        await this.refreshState();
        return;
    }

    uploadSourceCode(
        sourceCodePath: string,
        timeout?: number,
    ): Promise<boolean> {
        return this.vm.uploadSourceCode(sourceCodePath, timeout);
    }

    proxify(timeout?: number): Promise<void> {
        return this.vm.proxify(timeout);
    }

    getSourceMap(): SourceMap {
        return this.vm.sourceMap;
    }


    private onBreakpointReached(state: WasmState): void {
        const sourceMap = this.vm.sourceMap;
        this.context =  new Context(state, sourceMap);
        this.emit(BackendDebuggerEvent.BreakpointReached, this.context, this.context.getCurrentSourceCodeLocation()!);
    }


    public onNewEvent(ev: WASM.Event): void {
        let allEvents: WASM.Event[] = this.context.events.values;
        if( this.vm instanceof OutOfPlaceVM){
            allEvents = this.vm.eventsToHandle;
        }else{
            allEvents.push(ev);
        }
        this.emit(BackendDebuggerEvent.NewEventArrived, ev, allEvents);
    }

    private async addBreakpoint(sourceCodeLocation: SourceCodeLocation): Promise<boolean>{
        const stateOnBp = this.stateToRequest();
        const bp = new Breakpoint(sourceCodeLocation, stateOnBp);
        bp.subscribe(this.onBreakpointReached.bind(this));
        if(!await this.vm.addBreakpoint(bp)){
            return false;
        }

        const sm = this.vm.sourceMap;
        const source = new Source(sm.sourceCodeFileName, sm.sourceCodeFilePath);
        this.breakpoints.push(new BreakpointBackend(bp, source));
        return true;
    }

    private async removeBreakpoint(sourceCodeLocation: SourceCodeLocation, timeout?: number): Promise<boolean> {
        let bpPosition = -1;
        const bpToRemove = new Breakpoint(sourceCodeLocation);

        const bp = this.breakpoints.find((bp, idx) =>{
            bpPosition = idx;
            return bp.bp.equals(bpToRemove);
        });

        if(bp === undefined){
            return true;
        }
        const success =  await this.vm.removeBreakpoint(bp.bp, timeout);
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
        const response: WasmState = await this.vm.sendRequest(state);
        const sourceMap = this.getSourceMap();
        this.context =  new Context(response, sourceMap);
        if(this.vm instanceof OutOfPlaceVM){
            this.context.events = this.vm.eventsToHandle;
        }
        this.emit(BackendDebuggerEvent.StateUpdated, this.context);
    }


    getCurrentContext(): Context | undefined {
        return this.context;
    }

    async setBreakPoints(bpsToSet: number[]): Promise<boolean> {

        // Delete removed breakpoints
        const bpsToDelete = this.breakpoints
            .filter(bp => !bpsToSet.includes(bp.linenr));
        const deletedReplies: boolean[] = [];
        for (let i = 0; i < bpsToDelete.length; i++) {
            deletedReplies.push(await this.removeBreakpoint({
                linenr: bpsToDelete[i].linenr}));
        }
        const allDeleted = deletedReplies.reduce((acc: boolean, v: boolean) => acc && v, true);
        if(!allDeleted){
            return false;
        }

        // Keep breakpoints that need to be added

        const bpsToAdd = bpsToSet.filter(linenr =>{
            return this.breakpoints.find(bp => bp.linenr === linenr) === undefined;
        });
        const addedReplies: boolean[] = [];
        for (let i = 0; i < bpsToAdd.length; i++) {
            addedReplies.push(await this.addBreakpoint({
                linenr: bpsToAdd[i]}));
        }
        const allAdded = addedReplies.reduce((acc: boolean, v: boolean) => acc && v, true);
        return allAdded;
    }
}

async function createPlatformConfig(config: UserConfig, vmConfigArgs: VMConfigArgs): Promise<PlatformBuilderConfig>{

    const deviceConfigArgs: DeviceConfigArgs = {
        // TODO handle name giving in toolkit
        name: config.boardName as string,
        deploymentMode: config.target
    };
    const boardFQN: BoardFQBN = {
        fqbn: config.fqbn as string,
        boardName: config.boardName as string
    };
    return new PlatformBuilderConfig(Platform.Arduino, config.baudrate as BoardBaudRate, boardFQN, deviceConfigArgs, vmConfigArgs);
}

export async function createTargetVM(deviceManager: DeviceManager, userConfig: UserConfig): Promise<WARDuinoVM>{
    const vmConfigArgs = createVMConfigArgs(userConfig);
    if(userConfig.target === DeploymentMode.DevVM){
        const maxWaitTime = 3000;
        const vm = await deviceManager.spawnDevelopmentVM(vmConfigArgs, maxWaitTime);
        return vm;
    }
    else if(userConfig.target === DeploymentMode.MCUVM && userConfig.debuggingMode !== DebuggingMode.outOfThings){
        const platformConfig = await createPlatformConfig(userConfig, vmConfigArgs);
        return await deviceManager.spawnHardwareVM(platformConfig);
    }
    else {
        throw new Error(`TODO: Unsupported Deployment mode ${userConfig.target}`);
    }
}

export async function createDebuggerBackend(devicesManager: DeviceManager, userConfig: UserConfig): Promise<RemoteDebuggerBackend> {
    const targetVM = await createTargetVM(devicesManager, userConfig);
    if(userConfig.debuggingMode === DebuggingMode.remoteDebugging){
        const dbg= new RemoteDebuggerBackend(targetVM);
        if(!await targetVM.subscribeOnNewEvent(dbg.onNewEvent.bind(dbg))){
            throw new Error('Could not subscribe to on New IO Event');
        }
        return dbg;
    }
    else if(userConfig.debuggingMode === DebuggingMode.edward){
        let ooVM: OutOfPlaceVM | undefined;
        const oopMode: OutOfPlaceMode =  OutOfPlaceMode.RedirectIO;
        if(userConfig.existingVM !== undefined && userConfig.existingVM && userConfig.toolPortExistingVM !== undefined){
            ooVM =  await devicesManager.existingVMAsOutOfPlaceVM(userConfig.toolPortExistingVM, targetVM, userConfig.serverPortForProxyCall, 10000);
        }else{
            ooVM = await devicesManager.spawnOutOfPlaceVM(targetVM, oopMode);
        }
        const dbg = new RemoteDebuggerBackend(ooVM);
        if(!(await ooVM.subscribeOnNewEvent((ev)=>{
            dbg.onNewEvent(ev);}))) {
            throw new Error('Could not subscribe to on New IO Event');
        }
        return dbg;
    }
    else if(userConfig.debuggingMode === DebuggingMode.outOfThings){

    }
    else {
        throw new Error(`unsupported debugging mode ${userConfig.debuggingMode}`);
    }
}
