import { Dimensions } from "react-native";

const yScreen=Dimensions.get("window").height;
const xScreen=Dimensions.get("window").width

export const Device={
    width:xScreen,
    height:yScreen,
}