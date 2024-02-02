import * as vscode from 'vscode';

// TODO validate configuration
import { readFileSync } from 'fs';
import { Breakpoint, BreakpointPolicy } from './State/Breakpoint';
import { DeviceConfig, DeploymentMode, VMConfigArgs, VMConfiguration, DeviceConfigArgs, listAvailableBoards, BoardBaudRate, listAllFQBN } from 'wasmito';

interface MockConfig {
    port: number;
    host: string;
    functions: Map<number, number>;
}

function DeserializeMockConfig(obj: any): MockConfig{
    const port: number = Number(obj.port);
    const host: string =  obj.hasOwnProperty('host') ? obj.host : 'localhost';
    const funcs_to_mock : number[]  = obj.func_ids;
    const mock_ids : number[]  = obj.mock_ids;
    const mappings: Map<number, number> = new Map();
    for (let i = 0; i < funcs_to_mock.length; i++) {
        mappings.set(funcs_to_mock[i], mock_ids[i]);
    }
    return {
        port: port,
        host: host,
        functions: mappings
    };
}

class InvalidDebuggerConfiguration extends Error {
    constructor(errormsg: string) {
        super(`InvalidDebuggerConfiguration: ${errormsg}`);
    }
};

export class OnStartConfig {
    public readonly flash: boolean = true;
    public readonly updateSource: boolean = false;
    public readonly pause: boolean = true;

    constructor(flash: boolean, updateSource: boolean, pause: boolean) {
        this.flash = flash;
        this.updateSource = updateSource;
        this.pause = pause;
    }

    static defaultConfig(): OnStartConfig {
        const flash = true;
        const source = false;
        const pause = true;
        return new OnStartConfig(flash, source, pause);
    }

    static fromAnyObject(obj: any): OnStartConfig {
        if (typeof obj !== 'object') {
            throw (new InvalidDebuggerConfiguration('`onStart` property expected to be an object'));
        }

        const c = { flash: true, updateSource: false, pause: false };

        if (obj.hasOwnProperty('flash')) {
            c.flash = obj.flash;
        }

        if (obj.hasOwnProperty('updateSource')) {
            c.updateSource = obj.updateSource;
        }

        if (obj.hasOwnProperty('pause')) {
            c.pause = obj.pause;
        }

        return new OnStartConfig(c.flash, c.updateSource, c.pause);
    }

}



export class WiFiCredentials {
    public readonly ssid: string;
    public readonly pswd: string;
    constructor(ssid: string, pswd: string) {
        this.ssid = ssid;
        this.pswd = pswd;
    }

    static validate(pathToCredentials: any): WiFiCredentials {
        const credentials = { 'ssid': '', 'pswd': '' };
        try {
            if (typeof pathToCredentials !== 'string') {
                throw (new InvalidDebuggerConfiguration('`wifiCredentials` is expected to be a path to a json file'));
            }
            const fileContent = readFileSync(pathToCredentials as string);
            const jsonObj = JSON.parse(fileContent.toString());
            if (jsonObj.hasOwnProperty('ssid')) {
                credentials.ssid = jsonObj['ssid'];
            }
            else {
                throw (new InvalidDebuggerConfiguration(`DebuggerConfig: Provided json path ${pathToCredentials} does not exist`));
            }

            if (jsonObj.hasOwnProperty('pswd')) {
                credentials.pswd = jsonObj['pswd'];
            }
            else {
                throw (new InvalidDebuggerConfiguration(`DebuggerConfig: ${pathToCredentials} misses 'pswd' property`));
            }
        }
        catch (e) {
            if (e instanceof InvalidDebuggerConfiguration) {
                throw e;
            }
            else if (e instanceof SyntaxError) {
                throw (new InvalidDebuggerConfiguration('DebuggerConfig: WifiCreditials is not valid JSON content'));
            }
            else {
                throw (new InvalidDebuggerConfiguration(`DebuggerConfig: Provided json path ${pathToCredentials} does not exist`));
            }
        }
        return new WiFiCredentials(credentials.ssid, credentials.pswd);
    }
}

export class ProxyConfig {
    static defaultPort = 8081;
    public port: number = ProxyConfig.defaultPort;
    public ip: string = '';
    public serialPort: string = '';
    public baudrate: number = -1;


    constructor(obj: any) {
        if (obj.hasOwnProperty('port')) {
            this.port = obj.port;
        }
        if (obj.hasOwnProperty('ip')) {
            this.ip = obj.ip;
        }
        if (obj.hasOwnProperty('serialPort')) {
            this.serialPort = obj.serialPort;
        }
        if (obj.hasOwnProperty('baudrate')) {
            this.baudrate = obj.baudrate;
        }
    }
}

export class OldDeviceConfig {

    static readonly emulatedDebugMode: string = 'emulated';
    static readonly embeddedDebugMode: string = 'embedded';
    static readonly allowedModes: Set<string> = new Set<string>([OldDeviceConfig.emulatedDebugMode, OldDeviceConfig.embeddedDebugMode]);
    static readonly defaultDebugPort: number = 8300;


    public readonly wifiCredentials: WiFiCredentials | undefined;

    public name: string = '';
    public port: number = -1;
    public ip: string = '';
    public debugMode: string = OldDeviceConfig.emulatedDebugMode;
    public proxyConfig: undefined | ProxyConfig;
    public onStartConfig: OnStartConfig;

    public serialPort: string = '';
    public baudrate: number = -1;
    public fqbn: string = '';

    private breakPoliciesActive = false;
    private breakpointPolicy: BreakpointPolicy = BreakpointPolicy.default;


    private mock?: MockConfig;

    constructor(obj: any) {
        if (obj.hasOwnProperty('wifiCredentials')) {
            const credentials = WiFiCredentials.validate(obj.wifiCredentials);
            this.wifiCredentials = new WiFiCredentials(credentials.ssid, credentials.pswd);
        }
        if (obj.hasOwnProperty('ip')) {
            this.ip = obj.ip;
        }
        if (obj.hasOwnProperty('port')) {
            this.port = obj.port;
        }
        else {
            this.port = OldDeviceConfig.defaultDebugPort;
        }

        if (OldDeviceConfig.allowedModes.has(obj.debugMode)) {
            this.debugMode = obj.debugMode;
        }
        else {
            throw (new InvalidDebuggerConfiguration(`No debugmode provided. Options: '${OldDeviceConfig.embeddedDebugMode}' or '${OldDeviceConfig.emulatedDebugMode}'`));
        }
        if (obj.hasOwnProperty('proxy')) {
            this.proxyConfig = new ProxyConfig(obj.proxy);
        }

        if (obj.hasOwnProperty('onStart')) {
            this.onStartConfig = OnStartConfig.fromAnyObject(obj.onStart);
        }
        else {
            this.onStartConfig = OnStartConfig.defaultConfig();
        }

        if (this.onStartConfig.flash) {
            if (!obj.hasOwnProperty('serialPort')) {
                throw (new InvalidDebuggerConfiguration('serialPort is missing. E.g "serialPort": "/dev/ttyUSB0"'));
            }
            if (!obj.hasOwnProperty('fqbn')) {
                throw (new InvalidDebuggerConfiguration('fqbn is missing from device configuration. E.g. "fqbn": "esp32:esp32:m5stick-c'));
            }
            if (!obj.hasOwnProperty('baudrate')) {
                throw (new InvalidDebuggerConfiguration('baudrate is missing from device configuration. E.g. "baudrate": 115200'));
            }
            if (typeof(obj.baudrate) !== 'number') {
                throw (new InvalidDebuggerConfiguration('baudrate is supposed to be a number'));
            }
            if (this.ip && this.ip !== '' && !!!this.wifiCredentials) {
                throw (new InvalidDebuggerConfiguration('`wifiCredentials` entry (path to JSON) is needed when compiling for OTA debugging'));
            }
        }
        this.serialPort = obj.serialPort;
        this.fqbn = obj.fqbn;
        this.baudrate = obj.baudrate;

        if (obj.hasOwnProperty('name')) {
            this.name = obj.name;
        } else if(this.debugMode === OldDeviceConfig.embeddedDebugMode){
            this.name = 'device unknown';
            if(this.ip !== ''){
                this.name = this.ip;
            }
            else if(this.serialPort !== ''){
                this.name = this.serialPort;
            }
        }
        else{
            this.name = 'emulator';
        }

        if (obj.hasOwnProperty('breakpointPoliciesEnabled') && obj.breakpointPoliciesEnabled) {
            this.breakPoliciesActive = true;
            this.breakpointPolicy = this.validateBreakpointPolicy(obj.breakpointPolicy);
        }
        if (obj.hasOwnProperty('mock')) {
            this.mock = DeserializeMockConfig(obj.mock);
        }
    }

    needsProxyToAnotherVM(): boolean {
        return !!this.proxyConfig && this.debugMode === OldDeviceConfig.emulatedDebugMode;
    }

    isForHardware(): boolean {
        return this.debugMode === OldDeviceConfig.embeddedDebugMode;
    }

    usesWiFi(): boolean {
        return !!this.wifiCredentials;
    }

    isBreakpointPolicyEnabled() {
        return this.breakPoliciesActive;
    }

    getBreakpointPolicy(): BreakpointPolicy {
        return this.breakpointPolicy;
    }

    setBreakpointPolicy(policy: BreakpointPolicy) {
        this.breakpointPolicy = policy;
    }

    mockEnabled(): boolean {
        return !!this.mock;
    }

    getMockConfig(): MockConfig {
        return this.mock!;
    }


    private validateBreakpointPolicy(policy: any): BreakpointPolicy {
        if(typeof(policy) !== 'string'){
            throw new InvalidDebuggerConfiguration('breakpoint policy is expected to be a string');
        }

        const found = Breakpoint.policies().find(p=> p === policy);
        if(typeof(found) === 'undefined'){
            let errorMsg = `breakpoint policy is invalid. Given ${policy}. Allowed policy: `;
            errorMsg += Breakpoint.policies().join(', ');
            throw new InvalidDebuggerConfiguration(errorMsg);
        }
        return found;
    }

    static defaultDeviceConfig(name: string = 'emulated-vm'): OldDeviceConfig {
        return new OldDeviceConfig({
            name: name,
            port: OldDeviceConfig.defaultDebugPort,
            debugMode: OldDeviceConfig.emulatedDebugMode
        });
    }

    static configForProxy(deviceName: string, mcuConfig: OldDeviceConfig) {
        const pc = {
            port: mcuConfig.proxyConfig?.port,
            ip: mcuConfig.ip,
            serialPort: mcuConfig.serialPort,
            baudrate: mcuConfig.baudrate
        };
        if ((pc.serialPort === '' || pc.baudrate === -1) && pc.ip === '') {
            throw (new InvalidDebuggerConfiguration('cannot proxy a device without `serialPort` and/or `IP` address'));
        }
        if (pc.ip !== '' && pc.port === undefined) {
            pc.port = ProxyConfig.defaultPort;
        }
        const flash = false;
        const updateSource = false;
        const pause = true;
        const os = new OnStartConfig(flash, updateSource, pause);


        const deviceConfig: any = {
            name: deviceName,
            ip: '127.0.0.1',
            port: OldDeviceConfig.defaultDebugPort,
            debugMode: OldDeviceConfig.emulatedDebugMode,
            proxy: pc,
            onStart: os,
            breakpointPoliciesEnabled: false
        };

        const launchConfig = vscode.workspace.getConfiguration('launch');
        const WARDuinoConfig = launchConfig.configurations[0];
        const mockConfig: any  = WARDuinoConfig.mock;
        if(!!mockConfig){
            deviceConfig['mock'] = {
                port: mockConfig.port,
                host: mockConfig.host,
                func_ids: mockConfig.funcs_to_mock,
                mock_ids: mockConfig.mock_ids

            };
        }
        return new OldDeviceConfig(deviceConfig);
    }

    static fromObject(obj: any): OldDeviceConfig {
        return new OldDeviceConfig(obj);
    }



    static fromWorkspaceConfig():  OldDeviceConfig{
        const config = vscode.workspace.getConfiguration();
        const baudRate: string = config.get('warduino.Baudrate') || '115200';
        const enableBreakpointPolicy = !!config.get('warduino.ExperimentalBreakpointPolicies.enabled');
        const debugMode: string = config.get('warduino.DebugMode')!;
        const flashOnStart = debugMode === OldDeviceConfig.embeddedDebugMode ? config.get('warduino.FlashOnStart') : false;
        const deviceConfig: any = {
            'debugMode': debugMode,
            'serialPort': config.get('warduino.Port'),
            'fqbn': config.get('warduino.Device'),
            'baudrate': +baudRate,
            'onStart': {
                'flash': flashOnStart,
                'updateSource': false,
                'pause': true
            },
            'breakpointPoliciesEnabled': enableBreakpointPolicy,
        };

        const launchConfig = vscode.workspace.getConfiguration('launch');
        const WARDuinoConfig = launchConfig.configurations[0];
        const mockConfig: any  = WARDuinoConfig.mock;
        if(!!mockConfig){
            deviceConfig['mock'] = {
                port: mockConfig.port,
                host: mockConfig.host,
                func_ids: mockConfig.funcs_to_mock,
                mock_ids: mockConfig.mock_ids

            };
        }

        return OldDeviceConfig.fromObject(deviceConfig);
    }
}

export enum DebuggingMode {
    remoteDebugging = 0,
    edward = 1,
}

const legacyTargetDeviceMapping= new Map<string, DeploymentMode>([
    ['development', DeploymentMode.DevVM],
    ['mcu', DeploymentMode.MCUVM],
]);

const debuggingModesMapping = new Map<string, DebuggingMode>([
    ['remote-debugging', DebuggingMode.remoteDebugging],
    ['edward', DebuggingMode.edward],
]);


export interface UserConfig {
    program: string;
    debuggingMode: DebuggingMode;
    target: DeploymentMode;


    serialPort?: string;
    baudrate?: number,
    boardName?: string,
    fqbn?: string

    existingVM?: boolean;
    toolPortExistingVM?: number;
    serverPortForProxyCall?: number;
}

export function createUserConfigFromLaunchArgs(lauchArguments: any): Promise<UserConfig> {
    const args = validateVSCodeLaunchArgs(lauchArguments);
    return fillMissingValues(args);
} 


function validateVSCodeLaunchArgs(lauchArguments: any):  UserConfig {
    if(typeof lauchArguments !== 'object'){
        throw new InvalidDebuggerConfiguration(`launchArguments are expected to be an object. Given ${typeof(lauchArguments)}`);
    }

    const program = lauchArguments.program;
    if(program === undefined || typeof program !== 'string') {
        throw new InvalidDebuggerConfiguration(`program is mandatory and expected to be string Given ${typeof(program)}`);
    }

    const selectedTarget = lauchArguments.target;
    if(selectedTarget === undefined || typeof selectedTarget !== 'string'){
        throw new InvalidDebuggerConfiguration(`Target is mandatory and expected to be a string either 'development' or 'mcu'. Given ${selectedTarget}`);
    }
    const target =  legacyTargetDeviceMapping.get(selectedTarget);
    if(target === undefined){
        throw new InvalidDebuggerConfiguration(`unsupported target. Given ${selectedTarget}`);
    }

    const selectedDebugMode = lauchArguments.debuggingMode;
    if(selectedDebugMode === undefined || typeof selectedDebugMode !== 'string'){
        throw new InvalidDebuggerConfiguration(`debuggingMode is mandatory and expected to be a string either 'remote-debugging' or 'edward'. Given ${selectedDebugMode}`);
    }
    const debugMode =  debuggingModesMapping.get(selectedDebugMode);
    if(debugMode === undefined){
        throw new InvalidDebuggerConfiguration(`unsupported debugging mode. Given ${selectedDebugMode}`);
    }
    
    if(lauchArguments.existingVM !== undefined && typeof lauchArguments.existingVM !== 'boolean'){
        throw new InvalidDebuggerConfiguration(`existingVM option should be a boolean current type ${typeof lauchArguments.existingVM}`);
    }
    if(lauchArguments.toolPortExistingVM !== undefined && typeof lauchArguments.toolPortExistingVM !== 'number'){
        throw new InvalidDebuggerConfiguration(`toolPortExistingVM option should be a number current type ${typeof lauchArguments.toolPortExistingVM}`);
    }

    if(lauchArguments.existingVM !== undefined && lauchArguments.toolPortExistingVM === undefined){
        throw new InvalidDebuggerConfiguration('toolPortExistingVM option should be set when existingVM is also enabled');
    }
    else if(lauchArguments.existingVM === undefined && lauchArguments.toolPortExistingVM !== undefined){
        throw new InvalidDebuggerConfiguration('existingVM option should be set when toolPortExistingVM is also enabled');
    }

    if(lauchArguments.serverPortForProxyCall !== undefined && typeof lauchArguments.serverPortForProxyCall !== 'number'){
        throw new InvalidDebuggerConfiguration('serverPortForProxyCall option should be a number');
    }

    const args: UserConfig = {
        program,
        target,
        debuggingMode: debugMode,
        existingVM: lauchArguments.existingVM,
        toolPortExistingVM: lauchArguments.toolPortExistingVM,
        serverPortForProxyCall: lauchArguments.serverPortForProxyCall
    };

    const selectedSerialPort = lauchArguments.serialPort;
    if(selectedSerialPort !== undefined){
        if(typeof selectedSerialPort !== 'string'){
            throw new InvalidDebuggerConfiguration('serialPort is expected to be a string');
        }
        else{
            args.serialPort = selectedSerialPort;
        }
    }

    const selectedFQBN = lauchArguments.fqbn;
    if(selectedFQBN !== undefined){
        if(typeof selectedFQBN !== 'string'){
            throw new InvalidDebuggerConfiguration('fqbn is expected to be a string');
        }
        else{
            args.fqbn = selectedFQBN;
        }
    }else if(target === DeploymentMode.MCUVM){
        throw new InvalidDebuggerConfiguration('fqbn is mandatory when targetting a MCU');
    }


    const selectedBaudrate = lauchArguments.baudRate;
    if(selectedBaudrate !== undefined){
        if(typeof selectedBaudrate !== 'number'){
            throw new InvalidDebuggerConfiguration('baudrate is expected to be a number');
        }
        else{
            args.baudrate = selectedBaudrate;
        }
    }
    return args;
}

async function fillMissingValues(args: UserConfig): Promise<UserConfig> {
    if(args.target !== DeploymentMode.MCUVM){
        return args;
    }

    // case where 
    if(args.serialPort === undefined){
        console.info('No serial port set for Board');
        console.info('searching for a serial port to use');
        const boards = await listAvailableBoards();
        if (boards.length === 0) {
            const errMsg = 'no serialPort provided nor a connected board detected';
            console.error(errMsg);
            throw new Error(errMsg);
        }
        args.serialPort = boards[0];
    }

    if(args.baudrate === undefined){
        console.info('No baudrate set');
        console.info(`failling back to default ${BoardBaudRate.BD_115200}`);
        args.baudrate = BoardBaudRate.BD_115200;
    }

    const fqbns = await listAllFQBN();
    const targetBoard = fqbns.find((board) => {
        return board.fqbn === args.fqbn;
    });
    if (targetBoard === undefined) {
        const errMsg = `No board found with fqbn ${args.fqbn}`;
        console.error(errMsg);
        throw new Error(errMsg);
    }
    args.fqbn = targetBoard.fqbn;
    if(targetBoard.boardName !=='' ){
        args.boardName = targetBoard.boardName;
    }
    return args;
}


export function createVMConfig(userConfig: UserConfig):  VMConfigArgs {
    const  vmConfigArgs: VMConfigArgs = {
        program: userConfig.program,
        disableStrictModuleLoad: true
    };

    if(userConfig.target === DeploymentMode.MCUVM) {
        if(userConfig.serialPort !== undefined){
            vmConfigArgs.serialPort = userConfig.serialPort;
        }
        if(userConfig.baudrate !==undefined ){
            vmConfigArgs.baudrate = userConfig.baudrate;
        }
    }
    return vmConfigArgs;
}