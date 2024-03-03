
export interface CommandConstant {
    title: string,
    command: string,
}

export const START_DEBUGGING_COMMAND: CommandConstant = {
    title: 'Start debugging a session on a local DevVM',
    command: 'warduinodebug.startDebuggingSession'
}; 

export const VIEW_DEVICE_COMMAND: CommandConstant = {
    title: 'View the session of the device',
    command: 'warduinodebug.viewDevice',
};
