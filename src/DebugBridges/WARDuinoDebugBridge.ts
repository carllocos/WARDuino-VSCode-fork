import {AbstractDebugBridge, Messages} from "./AbstractDebugBridge";
import {DebugBridgeListener} from "./DebugBridgeListener";
import {ReadlineParser, SerialPort} from 'serialport';
import {DebugInfoParser} from "../Parsers/DebugInfoParser";
import {InterruptTypes} from "./InterruptTypes";
import {exec} from "child_process";
import {SourceMap} from "../CompilerBridges/SourceMap";

export class WARDuinoDebugBridge extends AbstractDebugBridge {
    private parser: DebugInfoParser = new DebugInfoParser();
    private wasmPath: string;
    private port: SerialPort | undefined;
    private readonly portAddress: string;
    private readonly sdk: string;
    private readonly tmpdir: string | undefined;
    private startAddress: number = 0;

    constructor(wasmPath: string,
                sourceMap: SourceMap | void,
                tmpdir: string,
                listener: DebugBridgeListener,
                portAddress: string,
                warduinoSDK: string) {
        super(sourceMap, listener);

        this.wasmPath = wasmPath;
        this.sourceMap = sourceMap;
        this.listener = listener;
        this.portAddress = portAddress;
        this.sdk = warduinoSDK;
        this.tmpdir = tmpdir;

        this.connect().then(() => {
            console.log("Plugin: Connected.");
            this.listener.connected();
        }).catch(reason => {
            console.log(reason);
        });
    }

    setVariable(name: string, value: number): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            console.log(`setting ${name} ${value}`);
            let local = this.getLocals(this.getCurrentFunctionIndex()).find(o => o.name === name);
            if (local) {
                let command = `21${this.convertToLEB128(local.index)}${this.convertToLEB128(value)} \n`;
                this.port?.write(command, err => {
                    resolve("Interrupt send.");
                });
            } else {
                reject("Local not found.");
            }
        });
    }

    setStartAddress(startAddress: number) {
        this.startAddress = startAddress;
    }

    run(): void {
        this.sendInterrupt(InterruptTypes.interruptRUN);
    }

    pause(): void {
        this.sendInterrupt(InterruptTypes.interruptPAUSE);
        this.listener.notifyPaused();
    }

    async connect(): Promise<string> {
        return new Promise(async (resolve, reject) => {
            this.listener.notifyProgress(Messages.compiling);
            await this.compileAndUpload();
            this.listener.notifyProgress(Messages.connecting);
            this.openSerialPort(reject, resolve);
            this.installInputStreamListener();
        });
    }

    public async upload() {
        await this.compileAndUpload();
    }


    private openSerialPort(reject: (reason?: any) => void, resolve: (value: string | PromiseLike<string>) => void) {
        this.port = new SerialPort({path: this.portAddress, baudRate: 115200},
            (error) => {
                if (error) {
                    reject(`Could not connect to serial port: ${this.portAddress}`);
                } else {
                    this.listener.notifyProgress(Messages.connected);
                    resolve(this.portAddress);
                }
            }
        );
    }

    public setBreakPoint(address: number) {
        let breakPointAddress: string = (this.startAddress + address).toString(16).toUpperCase();
        let command = `060${(breakPointAddress.length / 2).toString(16)}${breakPointAddress} \n`;
        console.log(`Plugin: sent ${command}`);
        this.port?.write(command);
    }

    private installInputStreamListener() {
        const parser = new ReadlineParser();
        this.port?.pipe(parser);
        parser.on("data", (line: any) => {
            this.parser.parse(this, line);
        });
    }

    public disconnect(): void {
        this.port?.close();
        this.listener.notifyProgress(Messages.disconnected);
    }

    private uploadArduino(path: string, resolver: (value: boolean) => void): void {
        this.listener.notifyProgress(Messages.reset);

        const upload = exec(`sh upload ${this.portAddress}`, {cwd: path}, (err, stdout, stderr) => {
                console.log(err);
                console.log(stdout);
            }
        );

        upload.on("data", (data: string) => {
            console.log(`stdout: ${data}`);
            if (data.search('Uploading')) {
                this.listener.notifyProgress(Messages.uploading);
            }
        });

        upload.on("close", (code) => {
            resolver(code === 0);
        });
    }

    public compileArduino(path: string, resolver: (value: boolean) => void): void {
        const compile = exec("make compile", {
            cwd: path
        });

        compile.on("error", (err => {
            resolver(false);
        }));

        compile.on("close", (code) => {
            if (code === 0) {
                this.listener.notifyProgress(Messages.compiled);
                this.uploadArduino(path, resolver);
            } else {
                resolver(false);
                this.listener.notifyProgress(Messages.error);
            }
        });
    }

    public compileAndUpload(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const sdkpath: string = this.sdk + "/platforms/Arduino/";
            const cp = exec(`cp ${this.tmpdir}/upload.c ${sdkpath}/upload.h`);
            cp.on("error", err => {
                resolve(false);
            });
            cp.on("close", (code) => {
                this.compileArduino(sdkpath, resolve);
            });
        });
    }

    private sendInterrupt(i: InterruptTypes, callback?: (error: Error | null | undefined) => void) {
        return this.port?.write(`${i} \n`, callback);
    }

    getCurrentFunctionIndex(): number {
        if (this.callstack.length === 0) {
            return -1;
        }
        return this.callstack[this.callstack.length - 1].index;
    }

    step(): void {
        this.sendInterrupt(InterruptTypes.interruptSTEP, function (err: any) {
            console.log("Plugin: Step");
            if (err) {
                return console.log("Error on write: ", err.message);
            }
        });
    }

    pullSession(): void {
        this.sendInterrupt(InterruptTypes.interruptWOODDump, function (err: any) {
            console.log("Plugin: WOOD Dump");
            if (err) {
                return console.log("Error on write: ", err.message);
            }
        });
    }

    pushSession(woodState: WOODState): void {
        console.log("Plugin: WOOD RecvState");
        let command = `0${InterruptTypes.interruptWOODRecvState}${woodState.toBinary()} \n`;
        this.port?.write(command);
    }

    refresh(): void {
        console.log("Plugin: Refreshing");
        this.sendInterrupt(InterruptTypes.interruptDUMPFull, function (err: any) {
            if (err) {
                return console.log("Error on write: ", err.message);
            }
        });
    }

    private convertToLEB128(a: number): string { // TODO can only handle 32 bit
        a |= 0;
        const result = [];
        while (true) {
            const byte_ = a & 0x7f;
            a >>= 7;
            if (
                (a === 0 && (byte_ & 0x40) === 0) ||
                (a === -1 && (byte_ & 0x40) !== 0)
            ) {
                result.push(byte_.toString(16).padStart(2, "0"));
                return result.join("").toUpperCase();
            }
            result.push((byte_ | 0x80).toString(16).padStart(2, "0"));
        }
    }
}