import { DebugBridge } from "./DebugBridge";
import { DebugBridgeListener } from "./DebugBridgeListener";
import { RunTimeTarget } from "./RunTimeTarget";
import { EmulatedDebugBridge } from "./EmulatedDebugBridge";
import { getFileExtension } from '../Parsers/ParseUtils';
import { HardwareDebugBridge } from "./HardwareDebugBridge";
import * as vscode from "vscode";
import { SourceMap } from "../State/SourceMap";
import { WOODDebugBridge } from "./WOODDebugBridge";
import { Messages } from "./AbstractDebugBridge";
import { EventsProvider } from "../Views/EventsProvider";
import { DeviceConfig } from "../DebuggerConfig";
import { StackProvider } from "../Views/StackProvider";
import { RuntimeViewsRefresher } from "../Views/ViewsRefresh";

function getConfig(id: string): string {
    const config: string | undefined = vscode.workspace.getConfiguration().get(id);
    if (config === undefined) {
        throw new Error(`${config} is not set.`);
    }
    return config;
}

export class DebugBridgeFactory {
    static makeDebugBridge(file: string, deviceConfig: DeviceConfig, sourceMap: SourceMap, viewsRefresher: RuntimeViewsRefresher, target: RunTimeTarget, tmpdir: string, listener: DebugBridgeListener): DebugBridge {
        let fileType = getFileExtension(file);
        let bridge;
        switch (fileType) {
            case "wast":
                const warduinoSDK: string = getConfig("warduino.WARDuinoToolChainPath");
                const portAddress: string = getConfig("warduino.Port");
                const fqbn: string = getConfig("warduino.Device");
                switch (target) {
                    // Emulated runtimes
                    case RunTimeTarget.emulator:
                        bridge = new EmulatedDebugBridge(file, deviceConfig, sourceMap, viewsRefresher, tmpdir, listener, warduinoSDK);
                        break;
                    case RunTimeTarget.wood:
                        bridge = new WOODDebugBridge(file, deviceConfig, sourceMap, viewsRefresher, tmpdir, listener, warduinoSDK);
                        break;
                        // Hardware runtimes
                    case RunTimeTarget.embedded:
                        bridge = new HardwareDebugBridge(file, deviceConfig, sourceMap, viewsRefresher, tmpdir, listener, portAddress, fqbn, warduinoSDK);
                        break;
                }

                bridge.connect().then(() => {
                    console.log('Plugin: Connected.');
                    listener.connected();
                }).catch(reason => {
                    console.error(reason);
                    listener.notifyError(Messages.connectionFailure);
                });
                return bridge;
        }
        throw new Error('Unsupported file type');
    }
}
