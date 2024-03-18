import * as vscode from 'vscode';

// TODO validate configuration
import { readFileSync } from 'fs';
import { Breakpoint, BreakpointPolicy } from './State/Breakpoint';
import { listAvailableBoards, BoardBaudRate, listAllFQBN, PlatformTarget, TargetLanguage} from 'wasmito';

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
    outOfThings =2,
}

const debuggingModesMapping = new Map<string, DebuggingMode>([
    ['remoteDebugging', DebuggingMode.remoteDebugging],
    ['edward', DebuggingMode.edward],
    ['outOfThings', DebuggingMode.outOfThings],
]);


export interface UserMCUConnectionConfig {

    // TODO make serialPort mandatory and provide port via GUI
    serialPort?: string; // default searches the first found port
    baudrate?: number,
    boardName?: string, // defaults Arduino's registered boardname
    fqbn: string
}


export async function assertAndCreateUserMCUConnectionConfig(config: any): Promise<UserMCUConnectionConfig> {
    if(typeof config !== 'object'){
        throw new InvalidDebuggerConfiguration('UserMCUConnnectionConfig expected to be of type object');
    }


    const boards = await listAvailableBoards();
    let serialPort = config.serialPort;
    if(serialPort === undefined){
        console.info('No serial port set for Board');
        console.info('searching for a serial port to use');
        if (boards.length === 0) {
            const errMsg = 'no serialPort provided nor a connected board detected';
            console.error(errMsg);
            throw new InvalidDebuggerConfiguration(errMsg);
        }
        serialPort = boards[0];
    }
    else if(typeof serialPort !== 'string'){
        throw new InvalidDebuggerConfiguration('serialPort is expected to be a string');
    }
    else if(boards.find((b)=>{
        return b === serialPort;
    }) === undefined){
        throw new InvalidDebuggerConfiguration(`given serialPort ${serialPort} is not connected to computer. Detected ports are: ${boards.join(', ')}`);
    }


    const fqbn = config.fqbn;
    if(fqbn === undefined){
        throw new InvalidDebuggerConfiguration('fqbn is mandatory when targetting a MCU');
    }
    else if(typeof fqbn !== 'string'){
        throw new InvalidDebuggerConfiguration('fqbn is expected to be a string');
    }

    const fqbns = await listAllFQBN();
    const targetBoard = fqbns.find((board) => {
        return board.fqbn === fqbn;
    });
    if (targetBoard === undefined) {
        const errMsg = `No board found with fqbn ${fqbn}`;
        console.error(errMsg);
        throw new InvalidDebuggerConfiguration(errMsg);
    }
        
    let baudrate = config.baudrate;
    if(baudrate === undefined){
        console.info('No baudrate set');
        console.info(`failling back to default ${BoardBaudRate.BD_115200}`);
        baudrate = BoardBaudRate.BD_115200;
    }
    else if(typeof baudrate !== 'number'){
        throw new InvalidDebuggerConfiguration('baudrate is expected to be a number');
    }

    let boardName = config.boardName;
    if(boardName === undefined){
        boardName = targetBoard.boardName;
    }
    else if(typeof boardName !== 'string'){
        throw new InvalidDebuggerConfiguration('boardName is expected to be a string');
    }
    else if(boardName !== ''){
        throw new InvalidDebuggerConfiguration('boardName is expected to be a non empty string');
    }


    return {
        serialPort,
        fqbn,
        boardName,
        baudrate
    };

}

export interface TargetProgram {
    targetLanguage: TargetLanguage,
    program: any,
}

export interface UserRemoteDebuggingConfig {
    program: TargetProgram,

    target: PlatformTarget;

    deployOnStart?: boolean; // defaults true
    
    // config for dev
    toolPortExistingVM?: number; // used if deployOnStart is False

    // config for mcu
    mcuConfig?: UserMCUConnectionConfig;
}

function isTargetLanguage(target: string): target is TargetLanguage {
    const found = Object.values(TargetLanguage).find((t)=>{
        return t === target;
    });
    return found !== undefined;
}

export function assertAndCreateTargetProgram(targetProgram: any): TargetProgram {
    if(typeof targetProgram !== 'object'){
        throw new InvalidDebuggerConfiguration('TargetProgram expected to be an object');
    }

    const targetLanguage = targetProgram.targetLanguage;
    if(!isTargetLanguage(targetLanguage)){
        throw new InvalidDebuggerConfiguration('Valid TargetLanguage expected');
    }

    return {
        targetLanguage,
        program: targetProgram.program
    };
}

export async function assertAndCreateUserRemoteDebuggingConfig(config: any): Promise<UserRemoteDebuggingConfig> {

    if(typeof config !== 'object'){
        throw new InvalidDebuggerConfiguration('UserRemoteDebuggingConfig expected to be an object');
    }

    let program = config.program;
    if(program === undefined) {
        throw new InvalidDebuggerConfiguration('program is mandatory');
    }
    program = assertAndCreateTargetProgram(program);

    let target = config.target;
    if(target === undefined || typeof target !== 'string'){
        throw new InvalidDebuggerConfiguration(`target is mandatory and expected to be a string either. Given ${target}`);
    }
    else{
        if(!isValidTargetPlatform(target)){
            throw new InvalidDebuggerConfiguration(`target is expected to be one of the values: ${Object.values(PlatformTarget).join(', ')}`);
        }
    }

    let deployOnStart = config.deployOnStart;
    if(deployOnStart !== undefined && typeof deployOnStart !== 'boolean'){
        throw new InvalidDebuggerConfiguration('deployOnStart is expected to be a boolean');
    }
    else if(deployOnStart === undefined){
        deployOnStart = true;
    }


    const toolPortExistingVM = config.toolPortExistingVM;
    if(toolPortExistingVM !== undefined && typeof toolPortExistingVM !== 'number'){
        throw new InvalidDebuggerConfiguration(`toolPortExistingVM is expected to be a number. Given ${toolPortExistingVM}`);
    }
    let mcuConfig = config.mcuConfig;
    if(mcuConfig !== undefined){
        mcuConfig = await assertAndCreateUserMCUConnectionConfig(mcuConfig);
    }
    if(target === PlatformTarget.Arduino && mcuConfig === undefined){
        throw new InvalidDebuggerConfiguration('mcuConfig is mandatory when targetting a mcu');
    }

    return {
        program,
        target,
        deployOnStart,
        toolPortExistingVM,
        mcuConfig
    };
}

export interface UserEdwardDebuggingConfig {
    program: TargetProgram,

    target: PlatformTarget,
    
    deployOnStart?: boolean; // defaults true
    
    // config for dev
    toolPortExistingVM?: number;
    serverPortForProxyCall?: number;

    // config for mcu
    mcuConfig?: UserMCUConnectionConfig;
}

export function isValidTargetPlatform(target: string): target is PlatformTarget {
    const found =  Object.values(PlatformTarget).find((t)=>{
        return t === target;
    });
    return found !== undefined;
}

export async function assertAndCreateEdwardDebuggingConfig(config: any): Promise<UserEdwardDebuggingConfig> {

    if(typeof config !== 'object'){
        throw new InvalidDebuggerConfiguration('UserEdwardDebuggingConfig expected to be an object');
    }

    let program = config.program;
    if(program === undefined) {
        throw new InvalidDebuggerConfiguration('program is mandatory');
    }
    program = assertAndCreateTargetProgram(program);

    let target = config.target;
    if(target === undefined || typeof target !== 'string'){
        throw new InvalidDebuggerConfiguration(`Target is mandatory and expected to be a string either. Given ${target}`);
    }
    else {
        if(!isValidTargetPlatform(target)){
            throw new InvalidDebuggerConfiguration(`target is expected to be one of the values: ${Object.values(DebuggingMode).join(', ')}`);
        }
    }

    let deployOnStart = config.deployOnStart;
    if(deployOnStart !== undefined && typeof deployOnStart !== 'boolean'){
        throw new InvalidDebuggerConfiguration('deployOnStart is expected to be a boolean');
    }
    else if(deployOnStart === undefined){
        deployOnStart = true;
    }


    const toolPortExistingVM = config.toolPortExistingVM;
    if(toolPortExistingVM !== undefined && typeof toolPortExistingVM !== 'number'){
        throw new InvalidDebuggerConfiguration(`toolPortExistingVM is expected to be a number. Given ${toolPortExistingVM}`);
    }

    const serverPortForProxyCall = config.serverPortForProxyCall;
    if(serverPortForProxyCall !== undefined && typeof serverPortForProxyCall !== 'number'){
        throw new InvalidDebuggerConfiguration(`serverPortProxyCall is expected to be a number. Given ${serverPortForProxyCall}`);
    }

    let mcuConfig = config.mcuConfig;
    if(mcuConfig !== undefined){
        mcuConfig = await assertAndCreateUserMCUConnectionConfig(mcuConfig);
    }
    if(target === PlatformTarget.Arduino && mcuConfig === undefined){
        throw new InvalidDebuggerConfiguration('mcuConfig is mandatory when targetting a mcu');
    }

    return {
        program,
        target,
        deployOnStart,
        toolPortExistingVM,
        mcuConfig
    };
}


export interface UserOutOfThingsDebuggingConfig {
    programOnTarget: TargetProgram,

    target: PlatformTarget,
    
    deployOnStart?: boolean; // defaults true
    
    // config for dev
    toolPortExistingVM?: number;
    serverPortForProxyCall?: number;

    // config for mcu
    mcuConfig?: UserMCUConnectionConfig;
}


export async function assertAndCreateOutOfThingsDebuggingConfig(config: any): Promise<UserOutOfThingsDebuggingConfig> {

    if(typeof config !== 'object'){
        throw new InvalidDebuggerConfiguration('UserOutOfThingsDebuggingConfig expected to be an object');
    }

    let programOnTarget = config.programOnTarget;
    if(programOnTarget === undefined) {
        throw new InvalidDebuggerConfiguration('programOnTarget is mandatory');
    }
    programOnTarget = assertAndCreateTargetProgram(programOnTarget);

    let target = config.target;
    if(target === undefined || typeof target !== 'string'){
        throw new InvalidDebuggerConfiguration(`Target is mandatory and expected to be a string either. Given ${target}`);
    }
    else {
        if(!isValidTargetPlatform(target)){
            throw new InvalidDebuggerConfiguration(`target is expected to be one of the values: ${Object.values(PlatformTarget).join(', ')}`);
        }
    }

    let deployOnStart = config.deployOnStart;
    if(deployOnStart !== undefined && typeof deployOnStart !== 'boolean'){
        throw new InvalidDebuggerConfiguration('deployOnStart is expected to be a boolean');
    }
    else if(deployOnStart === undefined){
        deployOnStart = true;
    }


    const toolPortExistingVM = config.toolPortExistingVM;
    if(toolPortExistingVM !== undefined && typeof toolPortExistingVM !== 'number'){
        throw new InvalidDebuggerConfiguration(`toolPortExistingVM is expected to be a number. Given ${toolPortExistingVM}`);
    }

    const serverPortForProxyCall = config.serverPortForProxyCall;
    if(serverPortForProxyCall !== undefined && typeof serverPortForProxyCall !== 'number'){
        throw new InvalidDebuggerConfiguration(`serverPortProxyCall is expected to be a number. Given ${serverPortForProxyCall}`);
    }

    let mcuConfig = config.mcuConfig;
    if(mcuConfig !== undefined){
        mcuConfig = await assertAndCreateUserMCUConnectionConfig(mcuConfig);
    }
    if(target === PlatformTarget.Arduino && mcuConfig === undefined){
        throw new InvalidDebuggerConfiguration('mcuConfig is mandatory when targetting a mcu');
    }

    return {
        programOnTarget,
        target,
        deployOnStart,
        toolPortExistingVM,
        mcuConfig
    };
}

export interface UserDeviceConfig {
    debug?: boolean,
    debuggingMode: DebuggingMode;
    remoteDebuggingConfig?: UserRemoteDebuggingConfig;
    edwardDebuggingConfig?: UserEdwardDebuggingConfig;
    outOfThingsConfig?: UserOutOfThingsDebuggingConfig;
}


export interface UserConfig {
    devices: UserDeviceConfig[];
}


export async function  assertAndCreateUserDeviceConfig(config: any): Promise<UserDeviceConfig> {
    if(typeof config !== 'object'){
        throw new InvalidDebuggerConfiguration('UserConfig expected to be an object');

    }

    let debug = config.debug;
    if(debug !== undefined && typeof debug !== 'boolean'){
        throw new InvalidDebuggerConfiguration(`debug is expected to be a boolean. Given ${debug}`);
    }else if(debug === undefined){
        debug = false;
    }

    if(config.debuggingMode === undefined || typeof config.debuggingMode !== 'string'){
        throw new InvalidDebuggerConfiguration(`debuggingMode is mandatory and expected to be a string either 'remote-debugging' or 'edward'. Given ${config.debuggingMode}`);
    }

    const debuggingMode =  debuggingModesMapping.get(config.debuggingMode);
    if(debuggingMode === undefined){
        throw new InvalidDebuggerConfiguration(`unsupported debugging mode. Expected: ${Array.from(debuggingModesMapping.keys()).join('. ')}. Given ${config.debuggingMode}`);
    }

    const userConfig: UserDeviceConfig = {
        debuggingMode,
        debug
    };

    if(debug){
        switch(debuggingMode){
            case DebuggingMode.remoteDebugging:
                userConfig.remoteDebuggingConfig = await assertAndCreateUserRemoteDebuggingConfig(config.remoteDebuggingConfig);
                break;
            case DebuggingMode.edward:
                userConfig.edwardDebuggingConfig = await assertAndCreateEdwardDebuggingConfig(config.edwardDebuggingConfig);
                break;
            case DebuggingMode.outOfThings:
                userConfig.outOfThingsConfig = await assertAndCreateOutOfThingsDebuggingConfig(config.outOfThingsConfig);
                break;
            default:
                throw new InvalidDebuggerConfiguration(`Provided unsupported debugging mode ${debuggingMode}`);
        }

    }

    return userConfig;
}



export async function createUserConfigFromLaunchArgs(config: any): Promise<UserConfig> {
    if(typeof config !== 'object'){
        throw new InvalidDebuggerConfiguration('UserConfig expected to be an object');
    }

    if(config.devices === undefined || !Array.isArray(config.devices)){
        throw new InvalidDebuggerConfiguration('devices is expected to be an array of UserDeviceConfig');
    }

    const devices = [];
    let hasOneSetForDebug = false;
    for (let i = 0; i < config.devices.length; i++) {
        const dc = await assertAndCreateUserDeviceConfig(config.devices[i]);
        devices.push(dc);
        if(!!dc.debug){
            hasOneSetForDebug = true;
        }
    }

    if(!hasOneSetForDebug){
        throw new InvalidDebuggerConfiguration('UserConfig should have at least one device set for debugging');
    }

    return {
        devices
    };
} 