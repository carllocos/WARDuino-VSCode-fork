
import { WARDuinoDebugSession } from '../DebugSession/DebugSession';
import { DeviceItem } from '../Views/DevicesProvider';

export async function viewDeviceCommand(wrd: WARDuinoDebugSession, resource: DeviceItem): Promise<void>{
    wrd.focusDebuggingOnDevice(resource.device);
};