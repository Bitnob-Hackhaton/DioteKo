import AsyncStorage from '@react-native-async-storage/async-storage';

// Methode pour enregistrer dans le localStorage
export const setItemStorage = async (key: string, value: string | number | boolean | null): Promise<void> => {
    try {
        await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        //console.log("Erreur lors de l'enregistrement ", error);
    }
};

// Methode pour recuperer une valeur du localStorage 
export interface GetItemStorage {
    <T = unknown>(key: string): Promise<T | null>;
}

export const getItemStorage: GetItemStorage = async <T = unknown>(key: string): Promise<T | null> => {
    try {
        const value = await AsyncStorage.getItem(key);
        return value != null ? JSON.parse(value) as T : null;
    } catch (error) {
        //console.log("Impossible de recuperer la donnee ", error);
        return null;
    }
};

// Methode pour supprimer du localStorage 
export interface RemoveItemStorage {
    (key: string): Promise<void>;
}

export const removeItemStorage: RemoveItemStorage = async (key: string): Promise<void> => {
    try {
        await AsyncStorage.removeItem(key);
    } catch (error) {
        //console.log("Impossible de supprimer la donnee ", error);   
    }
};