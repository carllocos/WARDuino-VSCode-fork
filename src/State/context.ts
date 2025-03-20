import { EventItem } from '../Views/EventsProvider';
import { WASM, WASMValueIndexed, WasmState as WasmitoState, LanguageAdaptor, WASMFunction, VariableInfo as WasmitoVariableInfo, WasmGlobal, WasmLocal, SourceCFGNode, sourceNodeLastInstructionStartAddress} from 'wasmito';

/*
* TODO move to toolkit 
*/ 


export class CallstackFrame {
    private readonly sourceMap: LanguageAdaptor;
    private readonly frame: WASM.Frame;
    public readonly sourceCodeLocation?: SourceCFGNode;
    private readonly frameType?: WASM.FrameType;
    private readonly wasmAddress: number;
    private readonly stack: StackValues;

    // relevant only for function frames
    public readonly function?: WASMFunction;
    private _locals: WasmLocal[];
    private _arguments: WasmitoVariableInfo[];
    private readonly _returnAddress: number;

    constructor(frame: WASM.Frame, sourceMap: LanguageAdaptor, wasmAddress: number, stack: StackValues){
        this.frame = frame;
        this.sourceMap = sourceMap;
        this.wasmAddress = wasmAddress;
        this.stack = stack;
        this.frameType = WASM.frameTypeFromNumber(this.frame.type); // TODO move to lib parsing inspectResponse
        this.sourceCodeLocation = this.getSourceCodeLocation();

        // only relevant for function frames
        this.function = this.getFunction();
        this._locals = this.getLocalsFromStack(stack);
        this._arguments = this.getArgumentsFromStack(stack);
        this._returnAddress = frame.ra;
    }

    copy(args?: {frame?: WASM.Frame, sourceMap?: LanguageAdaptor, wasmAddress?: number, stack?: StackValues}): CallstackFrame {
        const f = args?.frame === undefined ? this.frame : args.frame;
        const s = args?.sourceMap === undefined ? this.sourceMap : args.sourceMap;
        const w = args?.wasmAddress === undefined ? this.wasmAddress : args.wasmAddress;
        const st = args?.stack === undefined ? this.stack : args.stack;
        return new CallstackFrame(f, s, w, st);
    }

    isFunctionFrame(): boolean {
        if(this.frameType === undefined){
            return false;
        }
        return this.frameType === WASM.FrameType.FUNC;
    }

    get index(): number {
        return this.frame.idx;
    }

    get locals(): WasmLocal[] {
       
        return this._locals;
    }


    get arguments(): WasmitoVariableInfo[]{
  
        return this._arguments;
    }

    get returnAddress(): number{
        return this._returnAddress;
    }

    private pointsToSourceCodeLocation(): boolean {
        return this.frameType !== WASM.FrameType.CALLBACK_GUARD && this.frameType !== WASM.FrameType.PROXY_GUARD;
    }

    private getSourceCodeLocation(): SourceCFGNode | undefined {
        if(this.pointsToSourceCodeLocation()){
            return this.sourceMap.sourceCFG?.nodesFromAddress(this.wasmAddress);
        }
        return undefined;
    }

    private getFunction(): WASMFunction | undefined{
        if(!this.isFunctionFrame()){
            return undefined;
        }

        const funcID = parseInt(this.frame.fidx);
        if(isNaN(funcID)){
            throw new Error(`Provided function id ${this.frame.fidx} could not be converted to a number`);
        }

        const func =  this.sourceMap.sourceMap.getFunction(funcID);
        if(func === undefined){
            throw new Error('could not find function associated with Frame. Perhaps invalid frame argument or sourcemap');
        }
        return func;
    }

    private getLocalsFromStack(stack: StackValues): WasmLocal[] {
        if(!this.isFunctionFrame()){
            return [];
        }
        const nrArgs = this.function!.type.nrArgs;
        const fp = this.frame.sp + 1;
        const locals = this.function!.locals.filter(l => l.index >= nrArgs);
        return locals.map(local => {
            const sv = stack.values[fp + local.index];
            return { index: local.index, name: local.name, type: local.type, mutable: local.mutable, value: sv.value };
        });
    }

    private getArgumentsFromStack(stack: StackValues): WasmitoVariableInfo[] {
        if(!this.isFunctionFrame()){
            return [];
        }

        const argsAmount = this.function!.type.nrArgs;
        if (argsAmount === 0) {
            return [];
        }
        const argStartIndex = this.frame.sp + 1;
        return  stack.values.slice(argStartIndex, argStartIndex + argsAmount).map((sv, argIndex) => {
            const nameArg = this.function!.locals.find(loc => {
                return loc.index === argIndex;
            })?.name || `arg${argIndex}`;
            const type = WASM.typeToString(sv.type);
            if(type === undefined){
                throw Error(`Received an unexisting wasm type ${sv.type}`);
            }
            return { index: sv.idx, name: nameArg, type: type, mutable: true, value: `${sv.value}` };
        });
    }

}


export class Callstack {
    private readonly sourceMap: LanguageAdaptor;
    private readonly _frames: CallstackFrame[];
    constructor(callstack: WASM.Frame[], sourceMap: LanguageAdaptor, currentWasmAddress: number, stack: StackValues){
        this.sourceMap = sourceMap;

        callstack = callstack.slice().sort((f1, f2) =>{
            return f1.idx - f2.idx;
        });

        const frms: CallstackFrame[] = [];
        let frameWasmAddress = currentWasmAddress;
        for (let index = callstack.length - 1; index >= 0; index--) {
            const frame = callstack[index];
            frms.push(new CallstackFrame(frame, sourceMap, frameWasmAddress, stack));
            frameWasmAddress = frame.ra;
        }
        this._frames = frms.slice().sort((f1, f2)=>{
            return f1.index - f2.index;
        });
    }

    public frames(): CallstackFrame[] {
        /*
        * because Wasm has different frames besides function frames
        * (e.g., Loop, If, block) where such frames have relevant pc
        * We need to transfer those pc to function frames
        * TODO: decide maybe show all frames despite of the type?
        * TODO: probably have to deal with issues like arguments to block
        */
        const funcFrames: CallstackFrame[]=[];
        const lastFrame= this._frames[this._frames.length - 1];
        let latestSourceCodeLoc = lastFrame.sourceCodeLocation;
        
        let saveSourceCodeLoc = true;
        for (let i = this._frames.length - 1; i >= 0; i--) {
            const frame = this._frames[i];
            const wasmAddr = latestSourceCodeLoc === undefined ? undefined : sourceNodeLastInstructionStartAddress(latestSourceCodeLoc);
            if(frame.isFunctionFrame()){
                funcFrames.push(frame.copy({
                    wasmAddress: wasmAddr
                }));
                saveSourceCodeLoc = true;
                latestSourceCodeLoc = undefined;
                continue;
            }

            if(saveSourceCodeLoc){
                latestSourceCodeLoc = frame.sourceCodeLocation;
                saveSourceCodeLoc = false;
            }
        }

        return funcFrames.reverse();
    }

    getFrameFromIndex(idx: number): CallstackFrame | undefined {
        return this._frames.find((f: CallstackFrame) =>{
            return f.index === idx;
        });
    }
    
    public getCurrentFunctionFrame(): CallstackFrame | undefined{
        for (let i = this._frames.length - 1; i >= 0; i--) {
            const f = this._frames[i];
            if(f.isFunctionFrame()){
                return f;
            }
        }
        return undefined;
    }

    public currentFunction(): undefined | WASM.Frame {

        // if (this.frames.length === 0) {
        //     return undefined;
        // }
        // return this.frames[this.frames.length - 1];
        throw Error('tODO');
    }
}


export class Events {
    private readonly sourceMap: LanguageAdaptor;
    private readonly _events: WASM.Event[];
    constructor(events: WASM.Event[], sourceMap: LanguageAdaptor){
        this.sourceMap = sourceMap;
        this._events = events;
    }

    public setEvents(events: EventItem[]): void {
        // this.events = events;
    }

    get values(): WASM.Event[] {
        return this._events;
    }
}

export class StackValues {
    private readonly sourceMap: LanguageAdaptor;
    private readonly _stack: WASMValueIndexed[];
    constructor(stack: WASMValueIndexed[], sourceMap: LanguageAdaptor){
        this.sourceMap = sourceMap;
        this._stack = stack.slice().sort((v1, v2) =>{
            return v1.idx - v2.idx;
        });

    }

    get values(): WASMValueIndexed[]{
        return this._stack;
    }
}


export class Globals {
    private readonly sourceMap: LanguageAdaptor;
    private readonly _globals: WasmGlobal[];
    constructor(globals: WASMValueIndexed[], sourceMap: LanguageAdaptor){
        this.sourceMap = sourceMap;
        this._globals = this.createGlobals(globals);
    }


    get values(): WasmGlobal[]{
        return this._globals;
    }

    public getGlobalFromName(name: string): WasmGlobal | undefined {
        return this._globals.find(g => g.name === name);
    }


    private createGlobals(globals: WASMValueIndexed[]): WasmGlobal []{
        return globals.map(v =>{
            const gb: WasmGlobal | undefined = this.sourceMap.sourceMap.wasm.getGlobalFromIndex(v.idx);
            if(gb === undefined){
                throw new Error(`failed to find global with id ${v.idx} in sourcemap`);
            }
            gb.value = v.value;
            return gb;
        });
    }
}


export class Context {
    private readonly wasmState: WasmitoState;
    public readonly langAdaptors: LanguageAdaptor;

    private readonly _callstack: Callstack;
    private _events: Events;
    private readonly _stack: StackValues;
    private readonly _globals: Globals;


    constructor(state: WasmitoState, langAdaptor: LanguageAdaptor) {
        this.langAdaptors = langAdaptor;
        this.wasmState = state;
        const pc = state.pc === undefined ? 0: state.pc;
        this._stack = new StackValues(state.stack ?? [], langAdaptor);
        this._callstack = new Callstack(state.callstack ?? [], langAdaptor, pc, this._stack);
        this._events = new Events(state.events ?? [], langAdaptor);
        this._globals = new Globals(state.globals ?? [], langAdaptor);
    }

    get globals(): Globals {
        return this._globals;
    }

    get events(): Events {
        return this._events;
    }

    set events(ev: Events)  {
        this._events = ev;
    }




    get callstack(): Callstack {
        return this._callstack;
    }

    get stack() {
        return this._stack;
    }

    get pc() {
        return this.wasmState.pc;
    }


    public getCurrentSourceCodeLocation(): SourceCFGNode | undefined {
        const pc = this.wasmState.pc;
        if(pc === undefined){
            return undefined;
        }
        return this.langAdaptors.sourceCFGs.nodesFromAddress(pc);
    }
}
