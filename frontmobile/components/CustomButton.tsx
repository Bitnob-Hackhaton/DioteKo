import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import React from 'react'

type CustomButtonProps={
    children:React.ReactNode,
    handlePress:()=>void,
    containerStyle?:string,
    textStyle?:string,
    isLoading?:boolean,
    disabled?:boolean
}

const CustomButton = ({children, handlePress, containerStyle, textStyle, isLoading, disabled = false}: CustomButtonProps) => {
  return (
    <TouchableOpacity 
      className={`justify-center items-center p-3 rounded-lg ${containerStyle} ${isLoading || disabled ? 'opacity-50' : ''}`}
      disabled={isLoading || disabled}
      onPress={handlePress}
    >
      <Text className={`text-xl font-psemibold justify-center items-center ${textStyle}`}> {children}</Text>
    </TouchableOpacity>
  
  )
}

export default CustomButton;

const styles = StyleSheet.create({
  button:{
    padding: 10,
    borderRadius: 10
  }
});