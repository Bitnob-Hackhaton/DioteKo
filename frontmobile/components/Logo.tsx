import { View, Image, StyleSheet } from 'react-native';

const Logo = () => {
  return (
    <View style={styles.logoContainer}>
      <Image 
        source={require('@/assets/images/DioteKoLogo.png')} 
        style={styles.logo}
        resizeMode="cover"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
    marginBottom: 20,
  },
  logo: {
    width: '70%',
    height: '70%',
  },
});

export default Logo;
